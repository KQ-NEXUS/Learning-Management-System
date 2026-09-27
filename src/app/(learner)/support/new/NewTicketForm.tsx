"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BTN_PRIMARY, CONTROL, FIELD, NOTE_DANGER, TEXTAREA } from "@/components/primitives/controls";
import {
  TicketAttachmentPicker,
  nextPickKey,
  type PickedFile,
} from "@/components/support/TicketAttachmentPicker";
import { TicketContextCard } from "@/components/support/TicketContextCard";
import { TICKET_CATEGORY_OPTIONS } from "@/components/support/ticket-labels";
import { uploadTicketAttachment } from "@/components/support/upload-ticket-attachment";
import { createTicketAction, type CreateTicketInput, type CreateTicketResult } from "./actions";

export type NewTicketContext = { kind: string; id: string; safeReference: string };

type Created = { reference: string; initialMessageId: string };
type FieldErrors = Partial<Record<"category" | "subject" | "message", string>>;

export function NewTicketForm({
  context: initialContext = null,
  createTicket = createTicketAction,
}: {
  context?: NewTicketContext | null;
  /** Injectable for tests; defaults to the Server Action. */
  createTicket?: (input: CreateTicketInput) => Promise<CreateTicketResult>;
}) {
  const router = useRouter();
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [context, setContext] = useState(initialContext);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  // Stored before any upload so a retry never calls create again.
  const created = useRef<Created | null>(null);
  const submitting = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  function setStatus(key: string, status: PickedFile["status"], error?: string) {
    setFiles((current) => current.map((f) => (f.key === key ? { ...f, status, error } : f)));
  }

  async function run() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setFormError(null);
    setErrors({});
    try {
      if (!created.current) {
        const outcome = await createTicket({
          category: category as CreateTicketInput["category"],
          subject,
          message,
          contextKind: context?.kind ?? null,
          contextId: context?.id ?? null,
        });
        if (!outcome.ok) {
          setErrors(outcome.fieldErrors ?? {});
          setFormError(outcome.message);
          setTimeout(() => summaryRef.current?.focus(), 0);
          return;
        }
        created.current = { reference: outcome.reference, initialMessageId: outcome.initialMessageId };
        setLocked(true);
      }

      const { reference, initialMessageId } = created.current;
      let failed = 0;
      for (const item of files) {
        if (item.status === "ready") continue;
        setStatus(item.key, "uploading");
        const upload = await uploadTicketAttachment(initialMessageId, item.file);
        if (upload.ok) {
          setStatus(item.key, "ready");
        } else {
          failed += 1;
          setStatus(item.key, "failed", upload.message);
        }
      }

      if (failed > 0) {
        setResult(
          `Ticket ${reference} was created, but ${failed} attachment(s) could not be uploaded. Try again from the ticket.`,
        );
        router.push(`/support/${encodeURIComponent(reference)}?upload=partial&failed=${failed}`);
        return;
      }
      setResult(`Ticket ${reference} was created.`);
      router.push(`/support/${encodeURIComponent(reference)}?created=1`);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const local: FieldErrors = {};
    if (!category) local.category = "Choose a category.";
    if (subject.trim().length < 3) local.subject = "Enter a subject of at least 3 characters.";
    if (message.trim().length < 3) local.message = "Enter a message of at least 3 characters.";
    if (Object.keys(local).length > 0) {
      setErrors(local);
      setFormError("Check the highlighted fields and try again.");
      setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    void run();
  }

  const busy = pending || files.some((f) => f.status === "uploading");

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-[640px] flex-col gap-4">
      <div ref={summaryRef} tabIndex={-1} className="outline-none">
        {formError && (
          <p role="alert" className={NOTE_DANGER}>
            {formError}
          </p>
        )}
      </div>

      <label className={FIELD}>
        Category
        <select
          className={CONTROL}
          value={category}
          disabled={busy || locked}
          aria-invalid={errors.category ? true : undefined}
          aria-describedby={errors.category ? "category-error" : undefined}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Select a category</option>
          {TICKET_CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {errors.category && (
        <p id="category-error" className="-mt-2 text-sm text-danger">
          {errors.category}
        </p>
      )}

      <label className={FIELD}>
        Subject
        <input
          type="text"
          className={CONTROL}
          maxLength={160}
          value={subject}
          disabled={busy || locked}
          aria-invalid={errors.subject ? true : undefined}
          aria-describedby={errors.subject ? "subject-error" : undefined}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>
      {errors.subject && (
        <p id="subject-error" className="-mt-2 text-sm text-danger">
          {errors.subject}
        </p>
      )}

      <label className={FIELD}>
        Message
        <textarea
          className={`${TEXTAREA} min-h-40`}
          maxLength={5000}
          value={message}
          disabled={busy || locked}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? "message-error" : undefined}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      {errors.message && (
        <p id="message-error" className="-mt-2 text-sm text-danger">
          {errors.message}
        </p>
      )}

      {context && (
        <TicketContextCard
          kind={context.kind}
          reference={context.safeReference}
          onRemove={locked || busy ? undefined : () => setContext(null)}
        />
      )}

      <TicketAttachmentPicker
        items={files}
        disabled={busy || locked}
        onAdd={(added) =>
          setFiles((current) => [
            ...current,
            ...added.map((file) => ({ key: nextPickKey(), file, status: "pending" as const })),
          ])
        }
        onRemove={(key) => setFiles((current) => current.filter((f) => f.key !== key))}
      />

      <div>
        <button type="submit" className={BTN_PRIMARY} disabled={busy}>
          {busy ? "Creating ticket…" : "Create ticket"}
        </button>
      </div>

      <p role="status" aria-live="polite" className="text-sm text-foreground">
        {result}
      </p>
    </form>
  );
}
