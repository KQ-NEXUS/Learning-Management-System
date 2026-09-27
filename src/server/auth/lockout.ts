/**
 * Session cookie constants.
 *
 * The per-account lockout that used to live here (5 failures locked the
 * account for 15 minutes) was replaced by per-device throttling in
 * `sign-in-throttle.ts` (F-14b): account lockout let anyone lock any account
 * and revealed which addresses had one.
 */

export const SESSION_COOKIE = "lms.session";
export const SESSION_TTL_DAYS = 7;
