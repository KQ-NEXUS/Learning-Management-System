/**
 * Confirmations that follow a redirect (see `components/feedback/FlashNotice`).
 *
 * A server action that redirects after a successful write names what happened
 * with one of these codes, via `withFlash(path, code)`. The destination page
 * turns the code into its message. The list is closed on purpose: the address
 * bar only ever carries a code, never the words shown.
 */

export const FLASH_PARAM = "done";

const MESSAGES = {
  "course-created": "Course created",
  "programme-created": "Programme created",
  "cohort-created": "Cohort created",
  "lesson-created": "Lesson created",
  "assessment-created": "Assessment created",
  "role-created": "Role created",
  "template-created": "Certificate template created",
  "ticket-created": "Your ticket has been sent",
} as const;

export type FlashCode = keyof typeof MESSAGES;

/** The message for a code, or `null` for anything not on the list. */
export function flashMessage(code: string): string | null {
  return Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code as FlashCode] : null;
}

/** `path` with the confirmation code added, keeping any query it already has. */
export function withFlash(path: string, code: FlashCode): string {
  return `${path}${path.includes("?") ? "&" : "?"}${FLASH_PARAM}=${code}`;
}
