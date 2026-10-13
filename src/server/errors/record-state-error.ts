import { UserInputError } from "./user-input-error";

/**
 * A fully authorised caller asked for a change the record's current state does not allow:
 * a session on a cancelled cohort, a second archive of an archived course, a rename of a
 * withdrawn module (Phase 15 launch checklist, rows W-13 and W-14).
 *
 * The message is a sentence written for the staff member, so an action may show it as it is.
 * It is thrown before anything is written: no row changes, no audit row, no domain event.
 * It is not an authorization refusal and leaves no `authorization.denied` row.
 */
export class RecordStateError extends UserInputError {
  constructor(message: string) {
    super(message);
    this.name = "RecordStateError";
  }
}
