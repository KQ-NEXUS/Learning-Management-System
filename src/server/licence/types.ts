/**
 * State vocabulary and the status snapshot DTO for the software-licence module
 * (Phase 14, plan 14-04). Types and one constant tuple only; no imports, so the
 * service, the view model and diagnostics can all share one definition.
 *
 * Nothing here carries raw licence text or signing material (T-14-04-05): the
 * snapshot is the allow-list of fields that may leave the service layer.
 */

/**
 * D-01, D-05: expired, grace, restricted continuity and invalid are separately
 * named states. This tuple mirrors the `LicenceState_state_check` constraint in
 * the 14-03 migration; the two must change together.
 */
export const LICENCE_STATES = [
  "UNLICENSED",
  "ACTIVE",
  "EXPIRING_SOON",
  "GRACE",
  "RESTRICTED_CONTINUITY",
  "INVALID",
  "VALIDATION_ATTENTION",
] as const;

export type LicenceStateName = (typeof LICENCE_STATES)[number];

/** Support contact copied from the signed payload (renewal and support details). */
export interface LicenceSupportContact {
  renewalEmail: string;
  supportEmail: string;
  phone: string | null;
  hours: string | null;
}

/** Closed outcome of the last verification attempt (a code, never free text). */
export type LicenceVerificationOutcome = "OK" | "FAILED" | "UNAVAILABLE";

/**
 * Immutable picture of the deployment's licence at one instant. All instants
 * are `Date` (UTC epoch) or null; display formatting lives in plan 14-06.
 */
export interface LicenceStatusSnapshot {
  state: LicenceStateName;
  reasonCode: string | null;
  isRestricted: boolean;
  everActivated: boolean;
  licenceId: string | null;
  keyId: string | null;
  schemaVersion: number | null;
  clientName: string | null;
  deploymentId: string | null;
  issuedAt: Date | null;
  notBefore: Date | null;
  expiresAt: Date | null;
  graceEndsAt: Date | null;
  timeZone: string | null;
  support: LicenceSupportContact | null;
  restrictedAt: Date | null;
  daysRemaining: number | null;
  daysToGraceEnd: number | null;
  underOneDay: boolean;
  lastVerifiedAt: Date | null;
  lastVerificationOutcome: LicenceVerificationOutcome | null;
  attentionSince: Date | null;
  clockAlertAt: Date | null;
  highWaterAt: Date | null;
  evaluatedAt: Date;
}
