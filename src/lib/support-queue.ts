/** Client-safe constants shared by the staff support queue and its read model. */
export const QUEUE_TABS = ["my-work", "unassigned", "open", "escalated", "resolved"] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

export const QUEUE_TAB_LABEL: Record<QueueTab, string> = {
  "my-work": "My work",
  unassigned: "Unassigned",
  open: "All open",
  escalated: "Escalated",
  resolved: "Recently resolved",
};

export type TicketQueueName =
  | "GENERAL_SUPPORT"
  | "ACCOUNTS"
  | "FINANCE"
  | "LEARNING_ASSESSMENT"
  | "TECHNICAL";

/** The exact five named queues (D-09). */
export const QUEUE_OPTIONS: ReadonlyArray<{ value: TicketQueueName; label: string }> = [
  { value: "GENERAL_SUPPORT", label: "General Support" },
  { value: "ACCOUNTS", label: "Accounts" },
  { value: "FINANCE", label: "Finance" },
  { value: "LEARNING_ASSESSMENT", label: "Learning & Assessment" },
  { value: "TECHNICAL", label: "Technical" },
];
