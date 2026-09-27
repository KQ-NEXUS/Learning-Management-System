export type TicketStatusValue =
  | "NEW"
  | "OPEN"
  | "ASSIGNED"
  | "ESCALATED"
  | "RESOLVED"
  | "CLOSED";

export type TicketPriorityValue = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export const TICKET_TRANSITIONS: Readonly<
  Record<TicketStatusValue, readonly TicketStatusValue[]>
> = Object.freeze({
  NEW: ["OPEN", "ASSIGNED", "ESCALATED", "RESOLVED"],
  OPEN: ["ASSIGNED", "ESCALATED", "RESOLVED"],
  ASSIGNED: ["OPEN", "ESCALATED", "RESOLVED"],
  ESCALATED: ["ASSIGNED", "OPEN", "RESOLVED"],
  RESOLVED: ["OPEN", "CLOSED"],
  CLOSED: [],
});

const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export class IllegalTicketTransitionError extends Error {
  readonly from: TicketStatusValue;
  readonly to: TicketStatusValue;

  constructor(from: TicketStatusValue, to: TicketStatusValue) {
    super(`A ticket cannot move from ${from} to ${to}.`);
    this.name = "IllegalTicketTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class TicketReasonRequiredError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`A reason is required for ${operation}.`);
    this.name = "TicketReasonRequiredError";
    this.operation = operation;
  }
}

export class TicketAlreadyAssignedError extends Error {
  readonly ownedByActor: boolean;

  constructor(ownedByActor: boolean) {
    super(
      ownedByActor
        ? "You already own this ticket."
        : "This ticket is already assigned to another agent. Ask a manager to reassign it.",
    );
    this.name = "TicketAlreadyAssignedError";
    this.ownedByActor = ownedByActor;
  }
}

export function assertTicketTransition(
  from: TicketStatusValue,
  to: TicketStatusValue,
): void {
  if (!TICKET_TRANSITIONS[from].includes(to)) {
    throw new IllegalTicketTransitionError(from, to);
  }
}

export function ticketReopenDeadline(resolvedAt: Date): Date {
  return new Date(resolvedAt.getTime() + REOPEN_WINDOW_MS);
}

export function canLearnerClose(status: TicketStatusValue): boolean {
  return status === "RESOLVED";
}

export function canLearnerReopen(
  status: TicketStatusValue,
  resolvedAt: Date | null,
  now: Date,
): boolean {
  return (
    status === "RESOLVED" &&
    resolvedAt !== null &&
    now.getTime() <= ticketReopenDeadline(resolvedAt).getTime()
  );
}

function assertNonEmptyReason(
  reason: string | null | undefined,
  operation: string,
): void {
  if (!reason?.trim()) {
    throw new TicketReasonRequiredError(operation);
  }
}

export function assertReopenReason(reason: string | null | undefined): void {
  assertNonEmptyReason(reason, "reopening a ticket");
}

export function assertEscalationReason(reason: string | null | undefined): void {
  assertNonEmptyReason(reason, "escalating a ticket");
}

export function assertPriorityReason(
  priority: TicketPriorityValue,
  reason: string | null | undefined,
): void {
  if (priority === "URGENT") {
    assertNonEmptyReason(reason, "setting Urgent priority");
  }
}

export function assertAssignmentReason(
  currentAssigneeId: string | null,
  nextAssigneeId: string,
  reason: string | null | undefined,
): void {
  if (currentAssigneeId !== null && currentAssigneeId !== nextAssigneeId) {
    assertNonEmptyReason(reason, "replacing the ticket owner");
  }
}

export function statusAfterPublicReply(
  status: TicketStatusValue,
): TicketStatusValue {
  return status === "NEW" ? "OPEN" : status;
}
