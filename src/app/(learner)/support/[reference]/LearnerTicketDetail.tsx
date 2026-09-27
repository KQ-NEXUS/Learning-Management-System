"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { ConfirmModal } from "@/components/primitives/ConfirmModal";
import {
  BTN,
  BTN_PRIMARY,
  NOTE_DANGER,
  NOTE_SUCCESS,
  NOTE_WARNING,
  TEXTAREA,
} from "@/components/primitives/controls";
import {
  TicketAttachmentPicker,
  nextPickKey,
  type PickedFile,
} from "@/components/support/TicketAttachmentPicker";
import { TicketContextCard } from "@/components/support/TicketContextCard";
import { TicketTimeline, type TimelineMessage } from "@/components/support/TicketTimeline";
import { TicketStatusPill, TicketTime, ticketCategoryLabel } from "@/components/support/ticket-labels";
import { uploadTicketAttachment } from "@/components/support/upload-ticket-attachment";
import {
  closeTicketAction,
  replyToTicketAction,
  reopenTicketAction,
  type TicketActionResult,
} from "./actions";

/** The learner-facing projection: nothing staff-shaped is representable here. */
export type LearnerTicketView = {
  reference: string;
  subject: string;
  category: string;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  context: { kind: string; safeReference: string } | null;
  canReply: boolean;
  canClose: boolean;
  canReopen: boolean;
  autoCloseAt: Date | null;
  messages: TimelineMessage[];
};

type Actions = {
  reply: typeof replyToTicketAction;
  reopen: typeof reopenTicketAction;
  close: typeof closeTicketAction;
};

const LIVE_ACTIONS: Actions = { reply: replyToTicketAction, reopen: reopenTicketAction, close: closeTicketAction };

const CONFLICT =
  "This ticket changed while you were working. We loaded the latest activity—review it and try again.";

function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value));
}

export function LearnerTicketDetail({
  ticket,
  banner,
  actions = LIVE_ACTIONS,
}: {
  ticket: LearnerTicketView;
  banner: { kind: "created" | "partial"; failed: number } | null;
  actions?: Actions;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [sentMessageId, setSentMessageId] = useState<string | null>(null);
  const busy = useRef(false);

  function setFileStatus(key: string, status: PickedFile["status"], message?: string) {
    setFiles((current) => current.map((f) => (f.key === key ? { ...f, status, error: message } : f)));
  }

  function handleFailure(result: Extract<TicketActionResult, { ok: false }>, fallback: string) {
    if (result.kind === "conflict") {
      setError(CONFLICT);
      router.refresh();
    } else {
      setError(result.kind === "invalid" ? result.message : fallback);
    }
  }

  async function uploadPending(messageId: string): Promise<number> {
    let failed = 0;
    for (const item of files) {
      if (item.status === "ready") continue;
      setFileStatus(item.key, "uploading");
      const outcome = await uploadTicketAttachment(messageId, item.file);
      if (outcome.ok) setFileStatus(item.key, "ready");
      else {
        failed += 1;
        setFileStatus(item.key, "failed", outcome.message);
      }
    }
    return failed;
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (!sentMessageId && body.trim().length === 0) {
      setError("Enter a reply before sending.");
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      let messageId = sentMessageId;
      if (!messageId) {
        const result = await actions.reply({ reference: ticket.reference, expectedVersion: ticket.version, body });
        if (!result.ok) {
          handleFailure(result, "Your message wasn’t sent. Your text and selected files are still here.");
          return;
        }
        messageId = result.messageId ?? null;
        setSentMessageId(messageId);
        setBody("");
      }
      const failed = messageId ? await uploadPending(messageId) : 0;
      if (failed > 0) {
        setNotice(`Your reply was sent, but ${failed} attachment(s) could not be uploaded. Retry the failed files.`);
        return;
      }
      setSentMessageId(null);
      setFiles([]);
      setNotice("Your reply was sent.");
      router.refresh();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function close() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await actions.close({ reference: ticket.reference, expectedVersion: ticket.version });
      if (!result.ok) handleFailure(result, "This ticket could not be closed.");
      else router.refresh();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function reopen(reason: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setReopenError(null);
    try {
      const result = await actions.reopen({ reference: ticket.reference, expectedVersion: ticket.version, reason });
      if (!result.ok) {
        setReopenError(result.kind === "conflict" ? CONFLICT : result.message);
        if (result.kind === "conflict") router.refresh();
        return;
      }
      setReopenOpen(false);
      router.refresh();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const resolved = ticket.status === "RESOLVED";
  const closed = ticket.status === "CLOSED";

  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <span className="font-mono break-all">{ticket.reference}</span>
        <span>{ticketCategoryLabel(ticket.category)}</span>
        <TicketStatusPill status={ticket.status} />
        <span>
          Created <TicketTime value={ticket.createdAt} />
        </span>
        <span>
          Updated <TicketTime value={ticket.updatedAt} />
        </span>
      </div>

      {banner?.kind === "created" && (
        <p role="status" className={NOTE_SUCCESS}>
          Ticket {ticket.reference} was created.
        </p>
      )}
      {banner?.kind === "partial" && (
        <p role="status" className={NOTE_WARNING}>
          Ticket {ticket.reference} was created, but {banner.failed} attachment(s) could not be uploaded. Try again
          from the ticket.
        </p>
      )}

      {ticket.context && <TicketContextCard kind={ticket.context.kind} reference={ticket.context.safeReference} locked />}

      <section aria-labelledby="timeline-heading" className="flex flex-col gap-4">
        <h2 id="timeline-heading" className="text-base font-semibold text-foreground">
          Conversation
        </h2>
        <TicketTimeline messages={ticket.messages} />
      </section>

      {error && (
        <p role="alert" className={NOTE_DANGER}>
          {error}
        </p>
      )}

      {ticket.canReply && (
        <form onSubmit={sendReply} className="flex flex-col gap-4" noValidate>
          <h2 className="text-base font-semibold text-foreground">Reply to support</h2>
          <label className="flex flex-col gap-2 text-sm font-semibold text-foreground">
            Message
            <textarea
              className={`${TEXTAREA} min-h-32`}
              maxLength={5000}
              value={body}
              disabled={pending}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <TicketAttachmentPicker
            items={files}
            disabled={pending}
            onAdd={(added) =>
              setFiles((current) => [
                ...current,
                ...added.map((file) => ({ key: nextPickKey(), file, status: "pending" as const })),
              ])
            }
            onRemove={(key) => setFiles((current) => current.filter((f) => f.key !== key))}
            onRetry={sentMessageId ? () => void sendReply({ preventDefault() {} } as React.FormEvent) : undefined}
          />
          <div>
            <button type="submit" className={`${BTN_PRIMARY} gap-2`} disabled={pending}>
              <Send aria-hidden className="size-4" />
              {pending ? "Sending…" : "Send reply"}
            </button>
          </div>
          <p role="status" aria-live="polite" className="text-sm text-foreground">
            {notice}
          </p>
        </form>
      )}

      {resolved && ticket.canReopen && ticket.autoCloseAt && (
        <section aria-labelledby="resolved-heading" className="flex flex-col gap-4 border-t border-foreground pt-6">
          <h2 id="resolved-heading" className="text-base font-semibold text-foreground">
            Did this solve the issue?
          </h2>
          <p className="text-sm text-muted-foreground">
            This ticket will close automatically on {formatDate(ticket.autoCloseAt)} unless you reopen it.
          </p>
          <div className="flex flex-wrap gap-2">
            {ticket.canClose && (
              <button type="button" className={BTN} disabled={pending} onClick={() => void close()}>
                Close ticket
              </button>
            )}
            <button type="button" className={BTN_PRIMARY} disabled={pending} onClick={() => setReopenOpen(true)}>
              Reopen ticket
            </button>
          </div>
        </section>
      )}

      {(closed || (resolved && !ticket.canReopen)) && (
        <section className="flex flex-col gap-4 border-t border-foreground pt-6">
          <p className="text-sm text-foreground">
            This ticket is closed. Create a new ticket if you need more help.
          </p>
          <div>
            <Link href="/support/new" className={BTN_PRIMARY}>
              Create a new ticket
            </Link>
          </div>
        </section>
      )}

      <ConfirmModal
        open={reopenOpen}
        eyebrow="Reopen ticket"
        title="Reopen this ticket"
        description="Tell support what still needs help. The ticket returns to the support queue."
        confirmLabel="Reopen ticket"
        tone="default"
        minReasonLength={3}
        reasonLabel="Reopen reason"
        pending={pending}
        error={reopenError}
        onConfirm={reopen}
        onCancel={() => setReopenOpen(false)}
      />
    </div>
  );
}
