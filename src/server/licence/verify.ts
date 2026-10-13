/**
 * Local licence verification (LIC-01, D-01, D-02).
 *
 * `verifyLicence` decides one thing: is this text a licence signed by a trusted
 * key, for this deployment (and pinned client), in a schema this build
 * understands? It returns a structured result and never throws for a bad
 * licence. It uses only embedded public key material and `node:crypto`; it
 * never makes a network call, collects telemetry or contacts a provider
 * (PRD 18.1, D-01).
 *
 * It deliberately does NOT compare the clock to `expiresAt` or `graceEndsAt`
 * (D-10, D-11): an expired licence with a valid signature verifies ok, and the
 * time-based state is derived only by plan 14-04. The one clock check is
 * `notBefore`, evaluated in `activate` mode only, so a deployment whose clock
 * runs behind an already-active licence is never locked out (D-12).
 *
 * Check order: envelope, header, key lookup, signature over the exact ASCII
 * bytes, and only then payload parse and binding checks.
 */

import { createPublicKey, verify } from "node:crypto";
import { SKEW_TOLERANCE_MS, SUPPORTED_SCHEMA_VERSIONS } from "./constants";
import { LicenceUnavailableError } from "./errors";
import {
  base64UrlDecode,
  licenceHeaderSchema,
  licencePayloadSchema,
  parseEnvelope,
  type LicenceRejectionCode,
} from "./format";
import type { TrustSet } from "./trust-set";

export type VerifyContext = {
  trustSet: TrustSet;
  /** The database-seeded deployment identifier (D-13). */
  deploymentId: string;
  /** The client pinned at first activation, or null before any activation (A5). */
  registeredClientId: string | null;
  now: Date;
  /**
   * `activate`: an upload being activated now (notBefore is enforced).
   * `runtime`: re-verification of an already-active licence (notBefore is not
   * evaluated, so a clock behind the licence never locks anyone out, D-12).
   */
  mode: "activate" | "runtime";
};

export type VerifiedLicence = {
  /** The signed file text, trimmed. */
  raw: string;
  keyId: string;
  schemaVersion: number;
  licenceId: string;
  clientId: string;
  clientName: string;
  deploymentId: string;
  issuedAt: Date;
  notBefore: Date;
  expiresAt: Date;
  graceEndsAt: Date;
  timeZone: string;
  support: {
    renewalEmail: string;
    supportEmail: string;
    phone?: string;
    hours?: string;
  };
};

export type VerifyResult =
  | { ok: true; licence: VerifiedLicence }
  | { ok: false; code: LicenceRejectionCode };

function reject(code: LicenceRejectionCode): { ok: false; code: LicenceRejectionCode } {
  return { ok: false, code };
}

function decodeJson(b64: string): unknown {
  return JSON.parse(base64UrlDecode(b64).toString("utf8")) as unknown;
}

export function verifyLicence(raw: string, ctx: VerifyContext): VerifyResult {
  const envelope = parseEnvelope(raw);
  if (!envelope.ok) return reject(envelope.code);

  // Header: pinned algorithm and key id. A wrong alg fails the schema literal.
  let headerJson: unknown;
  try {
    headerJson = decodeJson(envelope.headerB64);
  } catch {
    return reject("BAD_FORMAT");
  }
  const header = licenceHeaderSchema.safeParse(headerJson);
  if (!header.success) return reject("BAD_FORMAT");

  const trusted = ctx.trustSet.get(header.data.kid);
  if (!trusted) return reject("UNKNOWN_KEY");
  if (trusted.status === "revoked") return reject("KEY_REVOKED");

  // A malformed shipped key is a configuration fault, not a bad licence.
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: trusted.x },
      format: "jwk",
    });
  } catch {
    throw new LicenceUnavailableError("A trusted licence key could not be loaded.");
  }

  // Signature over the exact ASCII bytes, before any payload JSON is parsed.
  let signatureValid = false;
  try {
    const signedBytes = Buffer.from(envelope.signedInput, "utf8");
    const signatureBytes = base64UrlDecode(envelope.signatureB64);
    signatureValid = verify(null, signedBytes, publicKey, signatureBytes);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return reject("BAD_SIGNATURE");

  // Payload: only trusted bytes are parsed from here on.
  let payloadJson: unknown;
  try {
    payloadJson = decodeJson(envelope.payloadB64);
  } catch {
    return reject("BAD_FORMAT");
  }
  // A future schema may carry a different shape, so an unrecognised integer
  // schemaVersion is reported before the v1 shape is enforced.
  if (typeof payloadJson === "object" && payloadJson !== null) {
    const version = (payloadJson as { schemaVersion?: unknown }).schemaVersion;
    if (
      typeof version === "number" &&
      Number.isInteger(version) &&
      !(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(version)
    ) {
      return reject("UNSUPPORTED_SCHEMA");
    }
  }
  const parsed = licencePayloadSchema.safeParse(payloadJson);
  if (!parsed.success) return reject("BAD_FORMAT");
  const payload = parsed.data;

  if (payload.deploymentId !== ctx.deploymentId) return reject("WRONG_DEPLOYMENT");
  if (ctx.registeredClientId !== null && payload.client.id !== ctx.registeredClientId) {
    return reject("WRONG_CLIENT");
  }

  const notBefore = new Date(payload.notBefore);
  if (ctx.mode === "activate" && ctx.now.getTime() + SKEW_TOLERANCE_MS < notBefore.getTime()) {
    return reject("NOT_YET_VALID");
  }

  const support: VerifiedLicence["support"] = {
    renewalEmail: payload.support.renewalEmail,
    supportEmail: payload.support.supportEmail,
  };
  if (payload.support.phone !== undefined) support.phone = payload.support.phone;
  if (payload.support.hours !== undefined) support.hours = payload.support.hours;

  return {
    ok: true,
    licence: {
      raw: raw.trim(),
      keyId: header.data.kid,
      schemaVersion: payload.schemaVersion,
      licenceId: payload.licenceId,
      clientId: payload.client.id,
      clientName: payload.client.name,
      deploymentId: payload.deploymentId,
      issuedAt: new Date(payload.issuedAt),
      notBefore,
      expiresAt: new Date(payload.expiresAt),
      graceEndsAt: new Date(payload.graceEndsAt),
      timeZone: payload.timeZone,
      support,
    },
  };
}
