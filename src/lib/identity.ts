/**
 * Shared identity constants — token purposes, TTLs, password floor, and
 * policy versions.
 *
 * Lives in `src/lib` (not `src/server`) because both server services and
 * client form components read these values, matching the precedent set by
 * `src/lib/permission-groups.ts`.
 */

export const TOKEN_PURPOSE = Object.freeze({
  EMAIL_VERIFICATION: "EMAIL_VERIFICATION",
  PASSWORD_RESET: "PASSWORD_RESET",
  EMAIL_CHANGE: "EMAIL_CHANGE",
} as const);

export type TokenPurpose = (typeof TOKEN_PURPOSE)[keyof typeof TOKEN_PURPOSE];

// D-02 — the asymmetry is deliberate: a reset link grants account access, so
// it gets a tighter window than an email-ownership check.
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
export const EMAIL_CHANGE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// D-19 — a NIST 800-63B-aligned length floor. No complexity-class rules.
export const MIN_PASSWORD_LENGTH = 10;

export const POLICY_TYPE = Object.freeze({
  TERMS: "terms",
  PRIVACY: "privacy",
  MARKETING: "marketing",
} as const);

// D-07 — bumped by hand when policy text changes; there is no CMS this phase.
export const POLICY_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  [POLICY_TYPE.TERMS]: "2026-09-02",
  [POLICY_TYPE.PRIVACY]: "2026-09-02",
  [POLICY_TYPE.MARKETING]: "2026-09-02",
});
