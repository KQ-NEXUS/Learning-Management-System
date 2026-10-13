import { StatusPill } from "@/components/primitives/ResourceTable";
import { LagosTime } from "@/components/time/LagosTime";

export const TICKET_CATEGORY_OPTIONS = [
  { value: "ACCOUNT_ACCESS", label: "Account access" },
  { value: "PAYMENT_ORDER", label: "Payment/order" },
  { value: "COURSE_CONTENT", label: "Course content" },
  { value: "ASSESSMENT_RESULT", label: "Assessment/result" },
  { value: "CERTIFICATE", label: "Certificate" },
  { value: "TECHNICAL_PROBLEM", label: "Technical problem" },
  { value: "OTHER", label: "Other" },
] as const;

export type TicketCategoryOptionValue = (typeof TICKET_CATEGORY_OPTIONS)[number]["value"];

export function ticketCategoryLabel(value: string): string {
  return TICKET_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

const STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "accent" }> = {
  NEW: { label: "New", tone: "neutral" },
  OPEN: { label: "Open", tone: "accent" },
  ASSIGNED: { label: "Assigned", tone: "accent" },
  ESCALATED: { label: "Escalated", tone: "warning" },
  RESOLVED: { label: "Resolved", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

/** Thin mapping layer over `StatusPill`; no independent styling. */
export function TicketStatusPill({ status }: { status: string }) {
  const entry = STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <StatusPill label={entry.label} tone={entry.tone} />;
}

/** Absolute Lagos-time timestamp ("5 Oct 2026, 14:30 WAT") with a machine-readable datetime (D-17). */
export function TicketTime({ value }: { value: Date | string }) {
  return <LagosTime value={value} className="font-mono text-xs text-muted-foreground" />;
}
