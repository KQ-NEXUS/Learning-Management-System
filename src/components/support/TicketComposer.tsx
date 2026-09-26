"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { StatusPill } from "@/components/primitives/ResourceTable";
import { BTN, BTN_PRIMARY, DIALOG_PANEL, DIALOG_SCRIM, NOTE_DANGER, NOTE_SUCCESS, TEXTAREA } from "@/components/primitives/controls";
import {
  TicketAttachmentPicker,
  nextPickKey,
  type PickedFile,
} from "@/components/support/TicketAttachmentPicker";
import { uploadTicketAttachment } from "@/components/support/upload-ticket-attachment";
import type { StaffTicketActionResult } from "@/app/staff/support/action-result";

export type ComposerProps = {
  /** Two visibly separate contracts: a learner-facing reply and a staff-only note. */
  mode: "public" | "internal";
  /** Required for public mode: who will receive the message. */
  recipient?: { name: string; email: string };
  submit: (body: string) => Promise<StaffTicketActionResult>;
};

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), [href], input:not([disabled]), select:not([disabled])';

/**
 * Public review step. Focus is trapped, Escape closes it while nothing is
 * pending, and focus returns to the opener. Only "Send reply" commits.
 */
function ReviewDialog({
  recipient,
  body,
  filenames,
  pending,
  error,
  onSend,
  onClose,
}: {
  recipient: { name: string; email: string };
  body: string;
  filenames: readonly string[];
  pending: boolean;
  error: string | null;
  onSend: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && !pending) {
      event.stopPropagation();
      onClose();
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

  return (
    <div className={DIALOG_SCRIM} onKeyDown={onKeyDown}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`${DIALOG_PANEL} max-h-full min-w-0 overflow-y-auto`}>
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] outline-none">
          Review reply
        </h2>
        <p className="text-sm text-muted-foreground">
          This message will be sent to the learner and is visible to them.
        </p>
        {error && <div role="alert" className={NOTE_DANGER}>{error}</div>}
        <dl className="flex min-w-0 flex-col gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Recipient</dt>
            <dd className="font-medium break-words [overflow-wrap:anywhere]">{recipient.name} ({recipient.email})</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Message</dt>
            <dd className="rounded-md bg-surface-2 p-3 break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{body}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Attachments</dt>
            <dd>
              {filenames.length === 0 ? (
                "None"
              ) : (
                <ul className="flex flex-col gap-1">
                  {filenames.map((name) => (
                    <li key={name} className="break-words [overflow-wrap:anywhere]">{name}</li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" disabled={pending} onClick={onClose} className={BTN}>Keep editing</button>
          <button type="button" disabled={pending} onClick={onSend} className={BTN_PRIMARY}>
            {pending ? "Sending…" : "Send reply"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TicketComposer({ mode, recipient, submit }: ComposerProps) {
  const router = useRouter();
  const internal = mode === "internal";
  const headingId = useId();
  const helperId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sentMessageId, setSentMessageId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  const busy = submitting || refreshing;
  const canSubmit = body.trim().length > 0 && !busy && !files.some((file) => file.status === "uploading");

  function closeReview() {
    setReviewing(false);
    queueMicrotask(() => openerRef.current?.focus());
  }

  async function uploadAll(messageId: string, targets: readonly PickedFile[]): Promise<number> {
    let failed = 0;
    for (const target of targets) {
      setFiles((current) => current.map((item) => (item.key === target.key ? { ...item, status: "uploading", error: undefined } : item)));
      const outcome = await uploadTicketAttachment(messageId, target.file);
      if (!outcome.ok) failed += 1;
      setFiles((current) =>
        current.map((item) =>
          item.key === target.key
            ? { ...item, status: outcome.ok ? "ready" : "failed", error: outcome.ok ? undefined : outcome.message }
            : item,
        ),
      );
    }
    return failed;
  }

  async function send() {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const result = await submit(body);
    if (!result.ok) {
      setSubmitting(false);
      // Body and files are retained on every failure (UI-SPEC 6.3).
      setReviewing(false);
      setError(result.kind === "conflict" ? result.message : `${internal ? "Your note wasn’t saved." : "Your message wasn’t sent."} Your text and selected files are still here. ${result.message}`);
      if (result.kind === "conflict") startRefresh(() => router.refresh());
      queueMicrotask(() => openerRef.current?.focus());
      return;
    }
    let failed = 0;
    if (result.messageId && files.length > 0) {
      setSentMessageId(result.messageId);
      failed = await uploadAll(result.messageId, files);
    }
    setSubmitting(false);
    setReviewing(false);
    setBody("");
    if (failed > 0) {
      setNotice(`${internal ? "Note saved" : "Reply sent"}, but ${failed} attachment${failed === 1 ? "" : "s"} could not be uploaded. Retry or remove ${failed === 1 ? "it" : "them"}.`);
    } else {
      setFiles([]);
      setSentMessageId(null);
      setNotice(internal ? "Internal note saved." : "Reply sent to the learner.");
    }
    // Chronology comes from the server; nothing is inserted optimistically.
    startRefresh(() => router.refresh());
  }

  async function retry(key: string) {
    const target = files.find((file) => file.key === key);
    if (!target || !sentMessageId) return;
    const failed = await uploadAll(sentMessageId, [target]);
    if (failed === 0) startRefresh(() => router.refresh());
  }

  const failedFiles = files.some((file) => file.status === "failed");
  const wrapper = internal
    ? "border-warning bg-warning-surface"
    : "border-border bg-surface";

  return (
    <section aria-labelledby={headingId} className={`flex min-w-0 flex-col gap-4 rounded-md border p-4 sm:p-6 ${wrapper}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h3 id={headingId} className="text-base font-semibold">{internal ? "Add internal note" : "Reply to learner"}</h3>
        {internal && <StatusPill label="Staff only" tone="warning" />}
      </div>
      <p id={helperId} className="text-sm text-foreground">
        {internal
          ? "Only staff can see this note."
          : recipient
            ? `Visible to the learner: ${recipient.name}.`
            : "Visible to the learner."}
      </p>
      {error && <div role="alert" className={NOTE_DANGER}>{error}</div>}
      {notice && <p role="status" className={NOTE_SUCCESS}>{notice}</p>}
      <label className="flex min-w-0 flex-col gap-2 text-sm font-semibold">
        {internal ? "Internal note" : "Message to learner"}
        <textarea
          rows={5}
          value={body}
          maxLength={5000}
          disabled={submitting}
          aria-describedby={helperId}
          onChange={(event) => setBody(event.target.value)}
          className={TEXTAREA}
        />
      </label>
      <TicketAttachmentPicker
        items={files}
        disabled={submitting}
        onAdd={(added) =>
          setFiles((current) => [
            ...current,
            ...added.map((file) => ({ key: nextPickKey(), file, status: "pending" as const })),
          ])
        }
        onRemove={(key) => setFiles((current) => current.filter((item) => item.key !== key))}
        onRetry={sentMessageId && failedFiles ? (key) => void retry(key) : undefined}
      />
      <div>
        {internal ? (
          <button type="button" disabled={!canSubmit} onClick={() => void send()} className={BTN_PRIMARY}>
            {submitting ? "Saving…" : "Save internal note"}
          </button>
        ) : (
          <button
            ref={openerRef}
            type="button"
            disabled={!canSubmit || !recipient}
            onClick={() => setReviewing(true)}
            className={BTN_PRIMARY}
          >
            Review reply
          </button>
        )}
      </div>
      {!internal && reviewing && recipient && (
        <ReviewDialog
          recipient={recipient}
          body={body.trim()}
          filenames={files.map((file) => file.file.name)}
          pending={submitting}
          error={null}
          onSend={() => void send()}
          onClose={closeReview}
        />
      )}
    </section>
  );
}
