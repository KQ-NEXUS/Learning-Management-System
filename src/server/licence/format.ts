/**
 * The published signed-licence contract, schema version 1 (D-02, owner
 * decision option-a recorded in 14-DECISIONS.md).
 *
 * One ASCII line: `LMS-LIC1.{header}.{payload}.{signature}`, each part
 * base64url without padding, at most 8192 characters, alphabet `A-Za-z0-9._-`.
 * The signed bytes are the exact ASCII string `LMS-LIC1.{header}.{payload}`;
 * the signature is checked over those bytes before any JSON is parsed, so no
 * canonicalisation step exists that two implementations could disagree about.
 *
 * This module is the single definition shared by the verifier
 * (`verify.ts`), the test fixtures and the provider tool (plan 14-05): signer
 * and verifier import the same `encodeLicenceEnvelope`, so they cannot drift.
 *
 * Pure: it imports only `zod` and sibling constants, never Prisma, a Next.js
 * request API or any network-capable module (D-01; asserted by
 * tests/licence-purity.test.ts).
 *
 * Changing a member name or rule here changes the contract for every issued
 * licence. The golden vectors under tests/fixtures/licence/schema-1/ must keep
 * passing after any edit.
 */

import { z } from "zod";
import { ENVELOPE_PREFIX, MAX_LICENCE_FILE_CHARS } from "./constants";

export { ENVELOPE_PREFIX };

// ---------------------------------------------------------------------------
// Rejection codes (closed set)
// ---------------------------------------------------------------------------

/**
 * Every licence rejection is exactly one of these codes. Order is part of the
 * contract (asserted by a test); the UI maps each to a fixed sentence.
 */
export const LICENCE_REJECTION_CODES = [
  "BAD_FORMAT",
  "UNSUPPORTED_SCHEMA",
  "UNKNOWN_KEY",
  "KEY_REVOKED",
  "BAD_SIGNATURE",
  "WRONG_DEPLOYMENT",
  "WRONG_CLIENT",
  "NOT_YET_VALID",
  "EXPIRED",
  "OLDER_THAN_ACTIVE",
  "ALREADY_ACTIVE",
] as const;
export type LicenceRejectionCode = (typeof LICENCE_REJECTION_CODES)[number];

// ---------------------------------------------------------------------------
// base64url (no padding)
// ---------------------------------------------------------------------------

const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]*$/;

/** base64url-encode bytes or a UTF-8 string, without padding. */
export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return bytes.toString("base64url");
}

/**
 * Decode a base64url string. Throws on any character outside the base64url
 * alphabet (Node's own decoder silently skips them) and on an impossible
 * length.
 */
export function base64UrlDecode(input: string): Buffer {
  if (!BASE64URL_ALPHABET.test(input) || input.length % 4 === 1) {
    throw new Error("Invalid base64url input.");
  }
  return Buffer.from(input, "base64url");
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

const ALLOWED_FILE_CHARS = /^[A-Za-z0-9._-]+$/;
const PREFIX_FAMILY = /^LMS-LIC\d+$/;

export type ParsedEnvelope =
  | {
      ok: true;
      headerB64: string;
      payloadB64: string;
      signatureB64: string;
      /** The exact ASCII bytes that are signed: prefix, dot, header, dot, payload. */
      signedInput: string;
    }
  | { ok: false; code: "BAD_FORMAT" | "UNSUPPORTED_SCHEMA" };

/** The exact string that is signed and verified. */
export function buildSignedInput(headerB64: string, payloadB64: string): string {
  return `${ENVELOPE_PREFIX}.${headerB64}.${payloadB64}`;
}

/**
 * Split an untrusted licence file into its three parts. Checks size and
 * alphabet before anything is decoded (T-14-02-03): trim once, then reject an
 * empty file, a file over MAX_LICENCE_FILE_CHARS, or any character outside
 * `A-Za-z0-9._-` (so interior whitespace and non-ASCII fail).
 */
export function parseEnvelope(raw: string): ParsedEnvelope {
  const text = raw.trim();
  if (
    text.length === 0 ||
    text.length > MAX_LICENCE_FILE_CHARS ||
    !ALLOWED_FILE_CHARS.test(text)
  ) {
    return { ok: false, code: "BAD_FORMAT" };
  }

  const parts = text.split(".");
  if (parts.length !== 4) return { ok: false, code: "BAD_FORMAT" };

  const [prefix, headerB64, payloadB64, signatureB64] = parts;
  if (prefix !== ENVELOPE_PREFIX) {
    // A well-formed LMS-LIC{n} family member this build does not recognise is
    // an unsupported schema, not a bad format (tolerant reader, D-02).
    return PREFIX_FAMILY.test(prefix)
      ? { ok: false, code: "UNSUPPORTED_SCHEMA" }
      : { ok: false, code: "BAD_FORMAT" };
  }
  if (headerB64.length === 0 || payloadB64.length === 0 || signatureB64.length === 0) {
    return { ok: false, code: "BAD_FORMAT" };
  }

  return {
    ok: true,
    headerB64,
    payloadB64,
    signatureB64,
    signedInput: buildSignedInput(headerB64, payloadB64),
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The header is inside the signed bytes. `alg` is pinned to the literal
 * Ed25519: the algorithm is never negotiated from the file (T-14-02-01).
 */
export const licenceHeaderSchema = z.object({
  alg: z.literal("Ed25519"),
  kid: z.string().regex(KEY_ID),
  typ: z.literal("lms-licence"),
  v: z.literal(1),
});
export type LicenceHeader = z.infer<typeof licenceHeaderSchema>;

const ISO_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** ISO-8601 UTC instant ending in Z that round-trips to a real calendar date. */
const isoInstant = z
  .string()
  .regex(ISO_UTC_INSTANT)
  .refine((value) => {
    const parsed = new Date(value);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 19) === value.slice(0, 19)
    );
  }, "Not a valid UTC instant");

const IDENTIFIER_CHARS = /^[A-Za-z0-9._-]+$/;

function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Payload schema v1. Deliberately non-strict: an unknown optional member is
 * stripped, not rejected (tolerant reader). A new REQUIRED member needs
 * `schemaVersion` 2 and a new envelope prefix.
 */
export const licencePayloadSchema = z
  .object({
    schemaVersion: z.number().int(),
    licenceId: z.string().min(1).max(64).regex(IDENTIFIER_CHARS),
    issuedAt: isoInstant,
    notBefore: isoInstant,
    expiresAt: isoInstant,
    graceEndsAt: isoInstant,
    client: z.object({
      id: z.string().min(1).max(128),
      name: z.string().min(1).max(200),
    }),
    deploymentId: z.string().min(1).max(100).regex(IDENTIFIER_CHARS),
    timeZone: z.string().min(1).max(64).refine(isKnownTimeZone, "Unknown IANA time zone"),
    support: z.object({
      renewalEmail: z.email().max(254),
      supportEmail: z.email().max(254),
      phone: z.string().max(40).optional(),
      hours: z.string().max(120).optional(),
    }),
  })
  .refine(
    (payload) =>
      Date.parse(payload.notBefore) <= Date.parse(payload.expiresAt) &&
      Date.parse(payload.expiresAt) <= Date.parse(payload.graceEndsAt) &&
      Date.parse(payload.issuedAt) <= Date.parse(payload.expiresAt),
    "Licence dates are out of order",
  );
export type LicencePayload = z.infer<typeof licencePayloadSchema>;

// ---------------------------------------------------------------------------
// Encoder (used by the test fixtures and the provider tool)
// ---------------------------------------------------------------------------

/**
 * The signature is produced over the encoded header and payload, so it is
 * supplied as a function of the signed input (or as pre-computed bytes for
 * tests that deliberately attach a wrong or empty signature).
 */
export type LicenceSignature = Uint8Array | ((signedInput: string) => Uint8Array);

/**
 * Serialise a licence into the published envelope. The single encoder used by
 * every signer, so signer and verifier cannot drift (D-02).
 */
export function encodeLicenceEnvelope(parts: {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: LicenceSignature;
}): string {
  const headerB64 = base64UrlEncode(JSON.stringify(parts.header));
  const payloadB64 = base64UrlEncode(JSON.stringify(parts.payload));
  const signatureBytes =
    typeof parts.signature === "function"
      ? parts.signature(buildSignedInput(headerB64, payloadB64))
      : parts.signature;
  return `${buildSignedInput(headerB64, payloadB64)}.${base64UrlEncode(signatureBytes)}`;
}
