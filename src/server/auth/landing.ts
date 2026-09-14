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
 * The two literal currency values `checkoutReturnPathFor` may ever
 * interpolate into its output — owned by THIS module, not imported from
 * `routing.ts` (07-03/`src/server/payments/`). Keeping the allowlist local
 * means this auth-domain module has no dependency on the payments domain,
 * and the "construct from an allowlist, never echo" property (below) is
 * self-contained rather than reaching into a sibling module for it.
 */
const SUPPORTED_INTENT_CURRENCIES = ["NGN", "USD"] as const;
type IntentCurrency = (typeof SUPPORTED_INTENT_CURRENCIES)[number];

function isSupportedIntentCurrency(value: string): value is IntentCurrency {
  return (SUPPORTED_INTENT_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Resolves where a learner lands right after authentication completes,
 * folding the D-14 checkout-intent detour into the same single decision
 * point `landingPathFor` already was.
 *
 * The single most important property of this function is that it
 * CONSTRUCTS its output rather than echoing input. `cohortIntent` carries a
 * bare `${cohortId}.${currency}` pair (07-04, D-07) — never a path or a
 * URL — and each half is interpolated into a fixed template this module
 * owns only after passing its own allowlist check: the id half against
 * `PLAUSIBLE_RECORD_ID`, the currency half against
 * `SUPPORTED_INTENT_CURRENCIES`. A value that fails either check — a
 * missing separator, an id containing a slash/colon/backslash/dot/percent
 * sign/whitespace/scheme-separator or simply too long to be a real id, or a
 * currency outside the two-value allowlist — is never interpolated; the
 * function falls back to `landingPathFor(user)` instead. Because the
 * destination is never caller-supplied, this code path cannot become an
 * open redirect (T-06-20), which matters here more than almost anywhere
 * else in the app: this is the function a freshly-authenticated learner's
 * browser is redirected through. The currency is re-derived from this
 * allowlist rather than interpolated from the cookie text for exactly the
 * same reason — an order must never be created from a guessed currency
 * (D-07).
 */
export function checkoutReturnPathFor(
  user: { isStaff?: boolean | null },
  cohortIntent: string | null | undefined,
): string {
  // A staff account is not a checkout actor, whatever the intent says.
  if (user.isStaff === true) return STAFF_LANDING_PATH;

  if (!cohortIntent) return landingPathFor(user);

  const separatorIndex = cohortIntent.indexOf(".");
  if (separatorIndex === -1) return landingPathFor(user);

  const id = cohortIntent.slice(0, separatorIndex);
  const currency = cohortIntent.slice(separatorIndex + 1);

  if (!PLAUSIBLE_RECORD_ID.test(id) || !isSupportedIntentCurrency(currency)) {
    return landingPathFor(user);
  }

  return `/enrol/${id}?currency=${currency}`;
}
