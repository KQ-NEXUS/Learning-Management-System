import { Paperclip } from "lucide-react";
import { StatusPill } from "@/components/primitives/ResourceTable";
import { TicketTime } from "@/components/support/ticket-labels";
import { QUEUE_OPTIONS } from "@/lib/support-queue";
import { humanizeCode } from "@/lib/humanize";

/**
 * Staff chronology: public messages, amber staff-only notes and compact
 * attributed lifecycle rows in one ordered list. Deliberately separate from the
 * learner `TicketTimeline`, whose type cannot carry internal entries. There is
 * no edit or delete affordance on any entry (D-13).
 */
export type StaffTimelineAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadStatus: string;
};

export type StaffTimelineEvent = {
  type: string;
  actorId: string | null;
  actorType: string;
  reason: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
  priorityBefore: string | null;
  priorityAfter: string | null;
  queueBefore: string | null;
  queueAfter: string | null;
  assigneeBeforeId: string | null;
  assigneeAfterId: string | null;
};

export type StaffTimelineEntry =
  | {
      kind: "MESSAGE";
      id: string;
      createdAt: Date | string;
      message: {
        authorId: string;
        visibility: "PUBLIC" | "INTERNAL";
        body: string;
        attachments: StaffTimelineAttachment[];
      };
    }
  | { kind: "EVENT"; id: string; createdAt: Date | string; event: StaffTimelineEvent };

const TYPE_LABEL: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "application/pdf": "PDF",
};
const QUEUE_LABEL: Record<string, string> = Object.fromEntries(QUEUE_OPTIONS.map((o) => [o.value, o.label]));
const PRIORITY_LABEL: Record<string, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };
const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  OPEN: "Open",
  ASSIGNED: "Assigned",
  ESCALATED: "Escalated",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** One plain-language sentence per lifecycle event, always naming the actor. */
export function describeTicketEvent(event: StaffTimelineEvent, names: Readonly<Record<string, string>>): string {
  const actor = event.actorId ? (names[event.actorId] ?? "A staff member") : event.actorType === "SYSTEM" ? "System" : "Someone";
  const owner = event.assigneeAfterId ? (names[event.assigneeAfterId] ?? "a staff member") : "nobody";
  switch (event.type) {
    case "CREATED":
      return `${actor} created the ticket`;
    case "CLAIMED":
      return `${actor} assigned the ticket to themselves`;
    case "ASSIGNED":
      return `${actor} assigned the ticket to ${owner}`;
    case "REASSIGNED":
      return `${actor} reassigned the ticket to ${owner}`;
    case "PRIORITY_CHANGED":
      return `${actor} changed priority from ${PRIORITY_LABEL[event.priorityBefore ?? ""] ?? "unset"} to ${PRIORITY_LABEL[event.priorityAfter ?? ""] ?? "unset"}`;
    case "QUEUE_CHANGED":
      return `${actor} moved the ticket from ${QUEUE_LABEL[event.queueBefore ?? ""] ?? "unset"} to ${QUEUE_LABEL[event.queueAfter ?? ""] ?? "unset"}`;
    case "ESCALATED":
      return `${actor} escalated the ticket to ${QUEUE_LABEL[event.queueAfter ?? ""] ?? "another queue"}${event.assigneeAfterId ? ` for ${owner}` : ""}`;
    case "ESCALATION_ACCEPTED":
      return `${actor} accepted the escalation`;
    case "RESOLVED":
      return `${actor} resolved the ticket`;
    case "REOPENED":
      return `${actor} reopened the ticket`;
    case "LEARNER_CLOSED":
      return `${actor} closed the ticket`;
    case "AUTO_CLOSED":
      return "The ticket closed automatically after the grace period";
    default:
      return `${actor} updated the ticket${event.statusAfter ? ` to ${STATUS_LABEL[event.statusAfter] ?? humanizeCode(event.statusAfter)}` : ""}`;
  }
}

export function StaffTicketTimeline({
  entries,
  names,
  learnerId,
}: {
  entries: readonly StaffTimelineEntry[];
  names: Readonly<Record<string, string>>;
  /** Used only to label a public message as from the learner or from Support. */
  learnerId?: string | null;
}) {
  return (
    <ol className="flex flex-col gap-4" aria-label="Ticket chronology">
      {entries.map((entry) => {
        if (entry.kind === "EVENT") {
          return (
            <li key={entry.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 border-l-2 border-border bg-surface-2 px-4 py-2">
              <span className="min-w-0 text-[13px] break-words text-muted-foreground [overflow-wrap:anywhere]">
                {describeTicketEvent(entry.event, names)}
                {entry.event.reason ? <> — <span className="whitespace-pre-wrap">Reason: {entry.event.reason}</span></> : null}
              </span>
              <TicketTime value={entry.createdAt} />
            </li>
          );
        }
        const { message } = entry;
        const internal = message.visibility === "INTERNAL";
        const author = names[message.authorId] ?? "Unknown user";
        const role = internal ? "Staff" : message.authorId === learnerId ? "Learner" : "Support";
        return (
          <li
            key={entry.id}
            className={`flex min-w-0 flex-col gap-2 rounded-md border p-4 sm:p-6 ${
              internal ? "border-warning bg-warning-surface" : "border-border bg-surface"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-3 text-[13px] font-semibold text-foreground">
                <span className="break-words [overflow-wrap:anywhere]">{author}</span>
                <span className="font-normal text-muted-foreground">{role}</span>
                {internal && <StatusPill label="Staff only" tone="warning" />}
              </span>
              <TicketTime value={entry.createdAt} />
            </div>
            <p className="text-sm break-words whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{message.body}</p>
            {message.attachments.length > 0 && (
              <ul className="flex flex-col gap-2" aria-label="Attachments">
                {message.attachments.map((attachment) => (
                  <li key={attachment.id} className="min-w-0 text-sm">
                    {attachment.uploadStatus === "READY" ? (
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
                    ) : (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Paperclip aria-hidden className="size-4 shrink-0" />
                        <span className="break-words [overflow-wrap:anywhere]">{attachment.filename}</span>
                        <span className="text-xs">(not available: {attachment.uploadStatus.toLowerCase()})</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
