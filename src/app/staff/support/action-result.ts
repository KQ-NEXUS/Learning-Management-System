import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { UserInputError } from "@/server/errors/user-input-error";
import { StaleTicketVersionError } from "@/server/services/ticket-service";
import { IllegalTicketTransitionError, TicketAlreadyAssignedError, TicketReasonRequiredError } from "@/server/services/ticket-lifecycle";

/** Typed result every staff ticket action returns; success is never assumed client-side. */
export type StaffTicketActionResult =
  | { ok: true; messageId?: string }
  | { ok: false; kind: "validation" | "denied" | "error"; message: string }
  | { ok: false; kind: "conflict"; message: string };

export const CONFLICT_MESSAGE =
  "This ticket changed while you were working. We loaded the latest activity—review it and try again.";

/** Maps typed service failures to a safe result; unknown errors are logged and never leaked. */
export function mapStaffTicketFailure(error: unknown): StaffTicketActionResult {
  if (error instanceof StaleTicketVersionError) return { ok: false, kind: "conflict", message: CONFLICT_MESSAGE };
  if (error instanceof AuthenticationError) {
    return { ok: false, kind: "denied", message: "Your session has ended. Sign in again." };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, kind: "denied", message: "Your role does not permit this ticket action." };
  }
  if (
    error instanceof TicketReasonRequiredError ||
    error instanceof TicketAlreadyAssignedError ||
    error instanceof IllegalTicketTransitionError ||
    error instanceof UserInputError
  ) {
    return { ok: false, kind: "validation", message: error.message };
  }
  console.error("Staff ticket action failed", error);
  return { ok: false, kind: "error", message: "The action did not complete. Nothing was changed." };
}
