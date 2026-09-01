/**
 * Login throttling rules (PRD IAM-06).
 *
 * Pure functions so the policy is testable without a database, and so the
 * thresholds live in one place rather than being scattered through the
 * sign-in path.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export const SESSION_COOKIE = "lms.session";
export const SESSION_TTL_DAYS = 7;

export function isLockedOut(
  user: { lockedUntil: Date | null },
  now: Date = new Date(),
): boolean {
  return user.lockedUntil !== null && user.lockedUntil > now;
}

export function nextFailureState(
  currentFailures: number,
  now: Date = new Date(),
): { failedLoginAttempts: number; lockedUntil: Date | null } {
  const failedLoginAttempts = currentFailures + 1;
  const lockedUntil =
    failedLoginAttempts >= MAX_FAILED_ATTEMPTS
      ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000)
      : null;
  return { failedLoginAttempts, lockedUntil };
}
