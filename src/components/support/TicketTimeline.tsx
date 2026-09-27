import { Paperclip } from "lucide-react";
import { TicketTime } from "@/components/support/ticket-labels";

/**
 * Learner-safe chronology. It accepts only the already-public learner
 * projection: there is no visibility toggle and no staff/internal entry type,
 * so nothing private can be rendered through this component.
 */
export type TimelineAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type TimelineMessage = {
  id: string;
  authorRole: "LEARNER" | "SUPPORT";
  body: string;
  createdAt: Date | string;
  attachments: TimelineAttachment[];
};

const TYPE_LABEL: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "application/pdf": "PDF",
};

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function TicketTimeline({ messages }: { messages: readonly TimelineMessage[] }) {
  return (
    <ol className="flex flex-col gap-4" aria-label="Ticket messages">
      {messages.map((message) => (
        <li key={message.id} className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-surface p-4 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              {message.authorRole === "LEARNER" ? "You" : "Support"}
            </span>
            <TicketTime value={message.createdAt} />
          </div>
          <p className="text-sm break-words whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
            {message.body}
          </p>
          {message.attachments.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Attachments">
              {message.attachments.map((attachment) => (
                <li key={attachment.id} className="min-w-0 text-sm">
                  <a
                    href={`/api/ticket-attachments/${attachment.id}/download`}
                    className="inline-flex min-h-11 min-w-0 items-center gap-2 text-accent hover:underline"
                  >
                    <Paperclip aria-hidden className="size-4 shrink-0" />
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{attachment.filename}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ({TYPE_LABEL[attachment.mimeType] ?? attachment.mimeType}, {formatSize(attachment.sizeBytes)})
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
