/**
 * Post-authentication landing path (IAM-03, D-15).
 *
 * A pure function rather than an inline conditional in each caller — the
 * redirect target is exactly the kind of value that gets duplicated across
 * `signInAction`, `registerAction`'s post-verification flow, and any future
 * caller, then drifts. `LEARNER_LANDING_PATH` will change once Phase 9 ships
 * a real learner dashboard; this is the one place that update needs to land.
 */

import { HOLD_MINUTES_DEFAULT } from "@/server/services/seat-accounting";

export const STAFF_LANDING_PATH = "/staff/courses";
export const LEARNER_LANDING_PATH = "/account";

export function landingPathFor(user: { isStaff?: boolean | null }): string {
  return user.isStaff === true ? STAFF_LANDING_PATH : LEARNER_LANDING_PATH;
}

/**
 * The checkout-intent cookie (REG-02, D-14) — carries a *bare cohort id*
 * across the identity detour (register -> email -> verify -> sign in), never
 * a path or URL. httpOnly so it cannot be read or set from script; distinct
 * name from `SESSION_COOKIE` (`lockout.ts`) so the two never collide.
 */
export const CHECKOUT_INTENT_COOKIE = "checkout_intent";

/**
 * `HOLD_MINUTES_DEFAULT` (30) is the seat-hold TTL, but the intent cookie
 * must outlive that by however long the verification email round trip takes
 * — the link may be opened hours later, from a different tab, the next day.
 * A stale intent costs nothing beyond one wasted redirect back to the
 * cohort's public page (the seat hold itself is re-checked fresh at
 * resumption, in `startCheckout`), so the margin is generous: 24 hours on
 * top of the default hold window.
 */
const CHECKOUT_INTENT_MARGIN_MINUTES = 24 * 60;
export const CHECKOUT_INTENT_MAX_AGE_SECONDS =
  (HOLD_MINUTES_DEFAULT + CHECKOUT_INTENT_MARGIN_MINUTES) * 60;

/**
 * A conservative allowlist for a Prisma `cuid()` id — lowercase/uppercase
 * letters and digits only, bounded length. Anything else is rejected, not
 * sanitised: this function never tries to salvage a hostile input into
 * something safe, it just falls back to the ordinary landing path.
 */
const PLAUSIBLE_RECORD_ID = /^[a-zA-Z0-9]{1,64}$/;

/**
 * Resolves where a learner lands right after authentication completes,
 * folding the D-14 checkout-intent detour into the same single decision
 * point `landingPathFor` already was.
 *
 * The single most important property of this function is that it
 * CONSTRUCTS its output rather than echoing input. `cohortIntent` is a bare
 * record id, never a path or a URL, and it is interpolated into a fixed
 * template this module owns after passing a conservative allowlist check.
 * A value that fails the check — containing a slash, a colon, a backslash,
 * a dot, a percent sign, whitespace, a scheme separator, or simply too long
 * to be a real id — is never interpolated; the function falls back to
 * `landingPathFor(user)` instead. Because the destination is never
 * caller-supplied, this code path cannot become an open redirect (T-06-20),
 * which matters here more than almost anywhere else in the app: this is the
 * function a freshly-authenticated learner's browser is redirected through.
 */
export function checkoutReturnPathFor(
  user: { isStaff?: boolean | null },
  cohortIntent: string | null | undefined,
): string {
  // A staff account is not a checkout actor, whatever the intent says.
  if (user.isStaff === true) return STAFF_LANDING_PATH;

  if (!cohortIntent || !PLAUSIBLE_RECORD_ID.test(cohortIntent)) {
    return landingPathFor(user);
  }

  return `/enrol/${cohortIntent}`;
}
