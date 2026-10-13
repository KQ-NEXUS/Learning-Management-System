/**
 * Versioned public-key trust set for licence verification (D-02, D-03).
 *
 * Statuses: `active` (signs and verifies), `retired` (verifies only, so a key
 * rotation never invalidates licences already issued), `revoked` (rejected).
 * Only public key material lives here; the private signing key never enters the
 * repository, configuration, backups or UI.
 *
 * Pure: imports only the sibling errors module.
 */

import { LicenceUnavailableError } from "./errors";

export type TrustedKeyStatus = "active" | "retired" | "revoked";

export type TrustedKey = {
  /** Key id carried in the licence header (`kid`). */
  kid: string;
  /** The `x` member of the key's Ed25519 public JWK (base64url). */
  x: string;
  status: TrustedKeyStatus;
};

export type TrustSet = ReadonlyMap<string, TrustedKey>;

/**
 * Production trust set. Empty in this repository: the provider adds the
 * production public key (the `x` value of its Ed25519 public JWK) through a
 * code release, after running the provider tool's keygen command. The private
 * key never enters the repository, configuration, backups or UI (D-03).
 */
export const PRODUCTION_TRUSTED_KEYS: readonly TrustedKey[] = [];

/**
 * Development and golden-vector keys (public halves only). The private halves
 * existed only in memory while tests/support/generate-licence-golden-vectors.ts
 * ran once and were never written anywhere. These keys are trusted only when
 * NODE_ENV is not production (assumption A8, accepted as a speed bump per PRD
 * 18.1; the commercial agreement is the primary control).
 */
export const DEV_TRUSTED_KEYS: readonly TrustedKey[] = [
  { kid: "dev-golden-a", x: "M-9qPV7zRTL9xLnS1nTCk3wHgy13DlRLmco1wH8iBOU", status: "active" },
  { kid: "dev-golden-b", x: "LY_XHoQY4Z0D5QhrcGbOq4iPP2mDcqXmvVgSPxr2xe0", status: "retired" },
  { kid: "dev-golden-c", x: "EUnINJSUMa-PoqFp8mYJWcVjEd72l-TRNh1u3SPZ59o", status: "revoked" },
];

/** Build a trust set keyed by kid. A duplicate kid is a configuration fault. */
export function buildTrustSet(keys: readonly TrustedKey[]): TrustSet {
  const set = new Map<string, TrustedKey>();
  for (const key of keys) {
    if (set.has(key.kid)) {
      throw new LicenceUnavailableError("Licence trust set contains a duplicate key id.");
    }
    set.set(key.kid, key);
  }
  return set;
}

/**
 * The trust set for this process. Development keys are included only when
 * `nodeEnv` (default `process.env.NODE_ENV`) is not "production".
 */
export function loadTrustSet(options: { nodeEnv?: string } = {}): TrustSet {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  return buildTrustSet(
    nodeEnv === "production"
      ? PRODUCTION_TRUSTED_KEYS
      : [...PRODUCTION_TRUSTED_KEYS, ...DEV_TRUSTED_KEYS],
  );
}
