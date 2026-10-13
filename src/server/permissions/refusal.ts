/**
 * Refusal helpers for actions and routes (Phase 14, plan 14-11; D-09).
 *
 * `LicenceRestrictedError` extends `AuthorizationError`, so a catch site that
 * only checks `instanceof AuthorizationError` would show the role-denial text
 * for a licence refusal. Actions call `refusalMessage` instead so the user sees
 * the licence refusal sentence when (and only when) the licence blocked them.
 */

import { LICENCE_REFUSAL_MESSAGE } from "@/server/licence/policy";
import { LicenceRestrictedError } from "./with-permission";

/** True when the error is the licence-state refusal from the choke point. */
export function isLicenceRestricted(error: unknown): error is LicenceRestrictedError {
  return error instanceof LicenceRestrictedError;
}

/** The fixed licence refusal sentence for a licence refusal, `deniedMessage` for anything else. */
export function refusalMessage(error: unknown, deniedMessage: string): string {
  return isLicenceRestricted(error) ? LICENCE_REFUSAL_MESSAGE : deniedMessage;
}
