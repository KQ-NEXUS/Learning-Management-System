/**
 * Post-authentication landing path (IAM-03, D-15).
 *
 * A pure function rather than an inline conditional in each caller — the
 * redirect target is exactly the kind of value that gets duplicated across
 * `signInAction`, `registerAction`'s post-verification flow, and any future
 * caller, then drifts. `LEARNER_LANDING_PATH` will change once Phase 9 ships
 * a real learner dashboard; this is the one place that update needs to land.
 */

export const STAFF_LANDING_PATH = "/staff/courses";
export const LEARNER_LANDING_PATH = "/account";

export function landingPathFor(user: { isStaff?: boolean | null }): string {
  return user.isStaff === true ? STAFF_LANDING_PATH : LEARNER_LANDING_PATH;
}
