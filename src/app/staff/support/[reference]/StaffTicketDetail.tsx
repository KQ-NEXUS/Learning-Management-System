"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useState } from "react";
import { DetailFacts, DetailLayout } from "@/components/primitives";
import { BTN } from "@/components/primitives/controls";
import { StaffTicketTimeline, type StaffTimelineEntry } from "@/components/support/StaffTicketTimeline";
import { TicketComposer } from "@/components/support/TicketComposer";
import { TicketPriorityPill, TicketStatusPill } from "@/components/support/TicketStatusPill";
import { TicketTime, ticketCategoryLabel } from "@/components/support/ticket-labels";
import { QUEUE_OPTIONS } from "@/lib/support-queue";
import type { StaffTicketWorkspace } from "@/server/services/ticket-staff-queue-service";
import { addInternalNoteAction, sendPublicReplyAction } from "./actions";

const QUEUE_LABEL: Record<string, string> = Object.fromEntries(QUEUE_OPTIONS.map((o) => [o.value, o.label]));
const KIND_LABEL: Record<string, string> = {
  COURSE: "Course",
  COHORT: "Cohort",
  ORDER: "Order",
  SUBMISSION: "Submission",
  CERTIFICATE: "Certificate",
  USER: "Account",
};

export type StaffTicketDetailProps = {
  workspace: StaffTicketWorkspace;
  /** Presentation hint only; every action re-checks tickets.manage server-side. */
  canManage: boolean;
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

export function StaffTicketDetail({ workspace, canManage }: StaffTicketDetailProps) {
  const [open, setOpen] = useState<{ public: boolean; internal: boolean }>({ public: false, internal: false });
  const { names } = workspace;
  const closed = workspace.status === "CLOSED";
  const learner = workspace.learner;
  const owner = workspace.assigneeId ? (names[workspace.assigneeId] ?? "Unknown user") : "Unassigned";
  const entries = workspace.timeline as unknown as StaffTimelineEntry[];

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
          submit={(body) => sendPublicReplyAction({ reference: workspace.reference, expectedVersion: workspace.version, body })}
        />
      </div>
      <div hidden={!open.internal}>
        <TicketComposer
          mode="internal"
          submit={(body) => addInternalNoteAction({ reference: workspace.reference, expectedVersion: workspace.version, body })}
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
    <DetailLayout
      mode="stacked"
      breadcrumbs={[{ label: "Operations" }, { label: "Support", href: "/staff/support" }, { label: workspace.reference }]}
      title={workspace.subject}
      identifier={workspace.reference}
      badges={<><TicketStatusPill status={workspace.status} /><TicketPriorityPill priority={workspace.priority} /></>}
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
  );
}
