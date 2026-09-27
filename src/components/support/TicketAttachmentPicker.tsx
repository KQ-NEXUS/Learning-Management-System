"use client";

import { useId, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import {
  TICKET_MAX_ATTACHMENTS_PER_MESSAGE,
  TICKET_MAX_ATTACHMENT_BYTES,
  TICKET_UPLOAD_MIME_TYPES,
} from "@/lib/upload-limits";
import { BTN } from "@/components/primitives/controls";

export type PickedFileStatus = "pending" | "uploading" | "ready" | "failed";

export type PickedFile = {
  key: string;
  file: File;
  status: PickedFileStatus;
  error?: string;
};

const STATUS_LABEL: Record<PickedFileStatus, string> = {
  pending: "Pending",
  uploading: "Uploading",
  ready: "Ready",
  failed: "Upload failed",
};

export const ATTACHMENT_HELPER = "Add up to 3 PNG, JPEG, WebP, or PDF files. Maximum 10 MB each.";

let pickSeq = 0;
export function nextPickKey(): string {
  pickSeq += 1;
  return `pick-${pickSeq}`;
}

/**
 * Local (pre-intent) validation. The server revalidates every rule; this only
 * avoids a wasted round trip and gives the exact UI-SPEC copy.
 */
export function validatePickedFiles(
  existingCount: number,
  candidates: readonly File[],
): { accepted: File[]; error: string | null } {
  const accepted: File[] = [];
  let error: string | null = null;
  for (const file of candidates) {
    if (existingCount + accepted.length >= TICKET_MAX_ATTACHMENTS_PER_MESSAGE) {
      error = `You can attach up to ${TICKET_MAX_ATTACHMENTS_PER_MESSAGE} files.`;
      break;
    }
    if (!TICKET_UPLOAD_MIME_TYPES.includes(file.type)) {
      error = "Choose a PNG, JPEG, WebP, or PDF file.";
      continue;
    }
    if (file.size > TICKET_MAX_ATTACHMENT_BYTES) {
      error = `${file.name} is larger than 10 MB.`;
      continue;
    }
    if (file.size <= 0) {
      error = "Choose a PNG, JPEG, WebP, or PDF file.";
      continue;
    }
    accepted.push(file);
  }
  return { accepted, error };
}

export function TicketAttachmentPicker({
  items,
  onAdd,
  onRemove,
  onRetry,
  disabled = false,
}: {
  items: readonly PickedFile[];
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  /** Present only once a message exists to attach to. */
  onRetry?: (key: string) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    const { accepted, error: message } = validatePickedFiles(items.length, chosen);
    setError(message);
    if (accepted.length > 0) onAdd(accepted);
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-[13px] font-semibold text-foreground">
        Attachments (optional)
      </label>
      <p id={helperId} className="text-xs text-muted-foreground">
        {ATTACHMENT_HELPER}
      </p>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={TICKET_UPLOAD_MIME_TYPES.join(",")}
        className="sr-only"
        disabled={disabled}
        aria-describedby={error ? `${helperId} ${errorId}` : helperId}
        onChange={handleChange}
      />
      <div>
        <button
          type="button"
          className={`${BTN} gap-2`}
          disabled={disabled || items.length >= TICKET_MAX_ATTACHMENTS_PER_MESSAGE}
          aria-describedby={helperId}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip aria-hidden className="size-4" />
          Choose files
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Selected files">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
            >
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.file.name}</span>
              <span className="flex flex-wrap items-center gap-2">
                <span
                  role="status"
                  className={item.status === "failed" ? "font-semibold text-danger" : "text-muted-foreground"}
                >
                  {STATUS_LABEL[item.status]}
                </span>
                {item.status === "failed" && onRetry && (
                  <button
                    type="button"
                    className="min-h-11 px-2 text-sm font-semibold text-accent hover:underline"
                    disabled={disabled}
                    aria-label={`Retry ${item.file.name}`}
                    onClick={() => onRetry(item.key)}
                  >
                    Retry
                  </button>
                )}
                {item.status !== "ready" && item.status !== "uploading" && (
                  <button
                    type="button"
                    className="min-h-11 px-2 text-sm font-semibold text-foreground hover:underline"
                    disabled={disabled}
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => onRemove(item.key)}
                  >
                    Remove
                  </button>
                )}
              </span>
              {item.status === "failed" && item.error && (
                <span className="w-full text-xs text-danger">{item.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
