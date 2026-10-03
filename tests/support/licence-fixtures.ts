/**
 * Test fixtures for the signed-licence contract (Phase 14, plan 14-02).
 *
 * Every key is a throwaway Ed25519 pair generated in memory per call and never
 * written to disk (D-03, T-14-02-04). `mintLicence` builds the file through
 * the production `encodeLicenceEnvelope`, so the signer under test and the
 * verifier share one format module and cannot drift.
 */

import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { DAY_MS } from "@/server/licence/constants";
import { encodeLicenceEnvelope } from "@/server/licence/format";
import {
  buildTrustSet,
  type TrustedKey,
  type TrustedKeyStatus,
  type TrustSet,
} from "@/server/licence/trust-set";

export const FIXTURE_DEPLOYMENT_ID = "fixture-deployment-0001";
export const FIXTURE_CLIENT = { id: "fixture-client-0001", name: "Fixture Training Academy" };
/** The fixed "current time" every fixture-based test evaluates against. */
export const FIXTURE_NOW = new Date("2026-10-01T12:00:00.000Z");

export type FixtureKey = {
  kid: string;
  privateKey: KeyObject;
  /** The `x` member of the public JWK, as shipped in a trust set. */
  x: string;
};

export function createFixtureKey(kid: string): FixtureKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (typeof jwk.x !== "string") throw new Error("Ed25519 public JWK is missing x");
  return { kid, privateKey, x: jwk.x };
}

/** A trust set over the given fixture keys (default status `active`). */
export function fixtureTrustSet(
  keys: ReadonlyArray<{ kid: string; x: string; status?: TrustedKeyStatus }>,
): TrustSet {
  const trusted: TrustedKey[] = keys.map((key) => ({
    kid: key.kid,
    x: key.x,
    status: key.status ?? "active",
  }));
  return buildTrustSet(trusted);
}

export type MintOptions = {
  /** Signing key; a fresh `fixture-key` is generated when omitted. */
  key?: FixtureKey;
  /** Header members to override; a value of `undefined` removes the member. */
  header?: Record<string, unknown>;
  /** Top-level payload members to override; `undefined` removes the member. */
  payload?: Record<string, unknown>;
  /**
   * `valid` (default) signs properly. `unsigned` attaches an empty signature
   * part. `wrong-key` signs with an unrelated freshly generated key.
   */
  signing?: "valid" | "unsigned" | "wrong-key";
};

export type MintedLicence = {
  raw: string;
  key: FixtureKey;
  /** A trust set holding only the signing key as `active`. */
  trustSet: TrustSet;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
};

let licenceCounter = 0;

/** The default payload: issued a day before FIXTURE_NOW, 90 days of term, 14 days of grace. */
export function defaultFixturePayload(): Record<string, unknown> {
  licenceCounter += 1;
  const issuedAt = new Date(FIXTURE_NOW.getTime() - DAY_MS);
  const expiresAt = new Date(FIXTURE_NOW.getTime() + 90 * DAY_MS);
  const graceEndsAt = new Date(expiresAt.getTime() + 14 * DAY_MS);
  return {
    schemaVersion: 1,
    licenceId: `fixture-licence-${licenceCounter}-${randomBytes(4).toString("hex")}`,
    issuedAt: issuedAt.toISOString(),
    notBefore: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    graceEndsAt: graceEndsAt.toISOString(),
    client: { ...FIXTURE_CLIENT },
    deploymentId: FIXTURE_DEPLOYMENT_ID,
    timeZone: "Africa/Lagos",
    support: {
      renewalEmail: "renewals@provider.example",
      supportEmail: "support@provider.example",
      phone: "+234 800 000 0000",
      hours: "Mon-Fri 09:00-17:00 WAT",
    },
  };
}

export function mintLicence(options: MintOptions = {}): MintedLicence {
  const key = options.key ?? createFixtureKey("fixture-key");
  const header: Record<string, unknown> = {
    alg: "Ed25519",
    kid: key.kid,
    typ: "lms-licence",
    v: 1,
    ...options.header,
  };
  const payload: Record<string, unknown> = { ...defaultFixturePayload(), ...options.payload };

  const signing = options.signing ?? "valid";
  const signer = signing === "wrong-key" ? createFixtureKey("unrelated-key") : key;
  const raw = encodeLicenceEnvelope({
    header,
    payload,
    signature:
      signing === "unsigned"
        ? new Uint8Array(0)
        : (signedInput) => sign(null, Buffer.from(signedInput, "utf8"), signer.privateKey),
  });

  return { raw, key, trustSet: fixtureTrustSet([key]), header, payload };
}
