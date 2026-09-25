"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BTN, BTN_PRIMARY, CONTROL, DIALOG_PANEL, DIALOG_SCRIM, FIELD, NOTE_DANGER, NOTE_WARNING, TEXTAREA } from "@/components/primitives/controls";
import { QUEUE_OPTIONS } from "@/lib/support-queue";
import type { StaffTicketActionResult } from "@/app/staff/support/action-result";

export type ActionVariant = "assign" | "reassign" | "queue" | "priority" | "escalate" | "resolve";

export type ActionPayload = {
  assigneeId?: string;
  queue?: string;
  priority?: string;
  reason?: string;
};

export type ActionAssignee = { id: string; name: string };

const PRIORITIES = [
  ["LOW", "Low"],
  ["NORMAL", "Normal"],
  ["HIGH", "High"],
  ["URGENT", "Urgent"],
] as const;

const COPY: Record<ActionVariant, { title: string; submit: string; pending: string; reasonLabel: string }> = {
  assign: { title: "Assign ticket", submit: "Assign ticket", pending: "Assigning…", reasonLabel: "Assignment reason" },
  reassign: { title: "Reassign ticket", submit: "Reassign ticket", pending: "Reassigning…", reasonLabel: "Reassignment reason" },
  queue: { title: "Move to queue", submit: "Move ticket", pending: "Moving…", reasonLabel: "Queue reason" },
  priority: { title: "Change priority", submit: "Change priority", pending: "Saving…", reasonLabel: "Priority reason" },
  escalate: { title: "Escalate ticket", submit: "Escalate ticket", pending: "Escalating…", reasonLabel: "Escalation reason" },
  resolve: { title: "Resolve ticket", submit: "Resolve ticket", pending: "Resolving…", reasonLabel: "Resolution note" },
};

const FOCUSABLE = "button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled])";

/**
 * Reason-capture dialog for every operational ticket action. Success is never
 * assumed: the parent supplies `submit`, which returns the server-confirmed
 * result. Input is kept on failure; on a version conflict the parent reloads the
 * latest ticket and the user must resubmit explicitly against the new version.
 */
export function TicketActionDialog({
  variant,
  currentAssigneeId,
  currentQueue,
  currentPriority,
  assignees,
  refreshing,
  submit,
  onClose,
}: {
  variant: ActionVariant;
  currentAssigneeId: string | null;
  currentQueue: string;
  currentPriority: string;
  assignees: readonly ActionAssignee[];
  /** True while the latest ticket is being reloaded after a conflict. */
  refreshing: boolean;
  submit: (payload: ActionPayload) => Promise<StaffTicketActionResult>;
  onClose: (outcome: "done" | "cancel") => void;
}) {
  const titleId = useId();
  const errorId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [queue, setQueue] = useState(currentQueue);
  const [priority, setPriority] = useState(currentPriority);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: "conflict" | "error"; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const copy = COPY[variant];

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const reasonRequired =
    variant === "reassign" || variant === "queue" || variant === "escalate" || variant === "resolve" ||
    (variant === "priority" && priority === "URGENT");
  const reasonNote = reasonRequired ? "Required" : "Optional";

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if ((variant === "assign" || variant === "reassign") && !assigneeId) next.assigneeId = "Choose who should own this ticket.";
    if (variant === "reassign" && assigneeId && assigneeId === currentAssigneeId) next.assigneeId = "Choose a different owner.";
    if (variant === "priority" && priority === currentPriority) next.priority = "Choose a different priority.";
    if (variant === "queue" && queue === currentQueue) next.queue = "Choose a different queue.";
    if (reasonRequired && !reason.trim()) next.reason = `${copy.reasonLabel} is required.`;
    return next;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || refreshing) return;
    const found = validate();
    setErrors(found);
    setBanner(null);
    if (Object.keys(found).length > 0) {
      const first = Object.keys(found)[0];
      panelRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    setPending(true);
    const result = await submit({
      ...(variant === "assign" || variant === "reassign" ? { assigneeId } : {}),
      ...(variant === "queue" || variant === "escalate" ? { queue } : {}),
      ...(variant === "escalate" && assigneeId ? { assigneeId } : {}),
      ...(variant === "priority" ? { priority } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    setPending(false);
    if (result.ok) {
      onClose("done");
      return;
    }
    setBanner({ kind: result.kind === "conflict" ? "conflict" : "error", message: result.message });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && !pending) {
      event.stopPropagation();
      onClose("cancel");
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === titleRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const ownerSelect = (label: string, required: boolean) => (
    <label className={FIELD}>
      {label} <span className="font-normal text-muted-foreground">({required ? "Required" : "Optional"})</span>
      <select
        data-field="assigneeId"
        value={assigneeId}
        disabled={pending}
        aria-invalid={Boolean(errors.assigneeId)}
        aria-describedby={errors.assigneeId ? errorId : undefined}
        onChange={(event) => setAssigneeId(event.target.value)}
        className={CONTROL}
      >
        <option value="">{required ? "Choose an owner" : "No owner yet"}</option>
        {assignees.map((assignee) => (
          <option key={assignee.id} value={assignee.id}>{assignee.name}</option>
        ))}
      </select>
      {errors.assigneeId && <span className="text-sm font-normal text-danger">{errors.assigneeId}</span>}
    </label>
  );

  return (
    <div className={DIALOG_SCRIM} onKeyDown={onKeyDown}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`${DIALOG_PANEL} max-h-full min-w-0 overflow-y-auto`}>
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] outline-none">
          {copy.title}
        </h2>
        {banner && (
          <div id={errorId} role="alert" className={banner.kind === "conflict" ? NOTE_WARNING : NOTE_DANGER}>
            {banner.message}
            {banner.kind === "conflict" && <p className="mt-1 text-sm">Your entries are kept. Submit again to apply them to the latest version.</p>}
          </div>
        )}
        <form onSubmit={(event) => void onSubmit(event)} className="flex min-w-0 flex-col gap-5" noValidate>
          {variant === "assign" && ownerSelect("Assignee", true)}
          {variant === "reassign" && ownerSelect("New owner", true)}
          {(variant === "queue" || variant === "escalate") && (
            <label className={FIELD}>
              {variant === "escalate" ? "Target queue" : "Queue"} <span className="font-normal text-muted-foreground">(Required)</span>
              <select
                data-field="queue"
                value={queue}
                disabled={pending}
                aria-invalid={Boolean(errors.queue)}
                onChange={(event) => setQueue(event.target.value)}
                className={CONTROL}
              >
                {QUEUE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {errors.queue && <span className="text-sm font-normal text-danger">{errors.queue}</span>}
            </label>
          )}
          {variant === "escalate" && ownerSelect("Escalate to owner", false)}
          {variant === "priority" && (
            <label className={FIELD}>
              Priority <span className="font-normal text-muted-foreground">(Required)</span>
              <select
                data-field="priority"
                value={priority}
                disabled={pending}
                aria-invalid={Boolean(errors.priority)}
                onChange={(event) => setPriority(event.target.value)}
                className={CONTROL}
              >
                {PRIORITIES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              {errors.priority && <span className="text-sm font-normal text-danger">{errors.priority}</span>}
            </label>
          )}
          <label className={FIELD}>
            {copy.reasonLabel} <span className="font-normal text-muted-foreground">({reasonNote})</span>
            <textarea
              data-field="reason"
              rows={4}
              value={reason}
              maxLength={1000}
              disabled={pending}
              aria-invalid={Boolean(errors.reason)}
              onChange={(event) => setReason(event.target.value)}
              className={TEXTAREA}
            />
            {errors.reason && <span className="text-sm font-normal text-danger">{errors.reason}</span>}
          </label>
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" disabled={pending} onClick={() => onClose("cancel")} className={BTN}>Cancel</button>
            <button type="submit" disabled={pending || refreshing} className={BTN_PRIMARY}>
              {pending ? copy.pending : refreshing ? "Loading latest…" : copy.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
