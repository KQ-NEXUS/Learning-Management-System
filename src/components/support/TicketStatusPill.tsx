import { StatusPill } from "@/components/primitives/ResourceTable";

export { TicketStatusPill } from "@/components/support/ticket-labels";

const PRIORITY: Record<string, { label: string; tone: "neutral" | "warning" | "danger" }> = {
  LOW: { label: "Low", tone: "neutral" },
  NORMAL: { label: "Normal", tone: "neutral" },
  HIGH: { label: "High", tone: "warning" },
  URGENT: { label: "Urgent", tone: "danger" },
};

/** Priority always carries its text label; tone is reinforcement only (UI-SPEC section 5). */
export function TicketPriorityPill({ priority }: { priority: string }) {
  const entry = PRIORITY[priority] ?? { label: priority, tone: "neutral" as const };
  return <StatusPill label={entry.label} tone={entry.tone} />;
}
