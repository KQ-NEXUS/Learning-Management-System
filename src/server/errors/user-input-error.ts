/**
 * F-14d — a refusal whose message was written for the person using the page
 * ("Select at least one reconciliation case."). Actions show `message` for
 * this class only. Any other error, including a runtime TypeError such as
 * "Cannot read properties of undefined", is logged and replaced by a safe
 * fallback, so internals never reach a learner or staff member.
 */
export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}
