/**
 * Provider-side licence issuer library (D-03, plan 14-05).
 *
 * PROVIDER-ONLY. This directory is excluded from the Docker build context
 * (.dockerignore) and from a client source handover, and must never be imported
 * by src or netlify code (asserted by tests/licence-issuer.test.ts).
 *
 * The issuer signs through the same format module the LMS verifier uses
 * (`encodeLicenceEnvelope`, `licenceHeaderSchema`, `licencePayloadSchema`), so a
 * licence it issues verifies with `verifyLicence` and signer and verifier cannot
 * drift (D-02). The private signing key never enters the repository: key
 * generation and key loading both refuse any path inside the repository root,
 * key generation refuses to overwrite a file, and nothing here returns or logs
 * private key material.
 *
 * Relative imports (not the `@/` alias) so this runs under `npx tsx` from the
 * repository root.
 */

import {
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DAY_MS } from "../../src/server/licence/constants";
import {
  base64UrlDecode,
  encodeLicenceEnvelope,
  licenceHeaderSchema,
  licencePayloadSchema,
  parseEnvelope,
} from "../../src/server/licence/format";

/** The repository root: two directories above this file. */
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Resolve symlinks and Windows short names for the nearest existing ancestor. */
function resolveReal(target: string): string {
  const absolute = path.resolve(target);
  const tail: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      const real = realpathSync.native(current);
      return path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Throws when `targetPath` is the repository root or lies inside it. A relative
 * path is resolved against the current directory first. Returns the resolved
 * absolute path when it is outside the repository.
 */
export function assertOutsideRepo(targetPath: string, repoRoot: string = DEFAULT_REPO_ROOT): string {
  const target = resolveReal(targetPath);
  const root = resolveReal(repoRoot);
  const relative = path.relative(root, target);
  const outside =
    relative !== "" &&
    (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`));
  if (!outside) {
    throw new Error(
      "Refusing to use a path inside the repository: the signing key must live outside the repository root.",
    );
  }
  return target;
}

export type GeneratedKey = {
  kid: string;
  /** The `x` member of the public Ed25519 JWK (base64url). */
  publicJwkX: string;
  /** Ready to paste into PRODUCTION_TRUSTED_KEYS in src/server/licence/trust-set.ts. */
  trustSetEntry: { kid: string; x: string; status: "active" };
};

/**
 * Generate an Ed25519 key pair, write the private key as a PKCS#8 PEM (mode
 * 0600) to `outPath` and return the public half only. Refuses a path inside the
 * repository and refuses to overwrite an existing file.
 */
export function generateKeyPairToFile(options: { kid: string; outPath: string }): GeneratedKey {
  const header = licenceHeaderSchema.shape.kid.safeParse(options.kid);
  if (!header.success) {
    throw new Error("The key id must be 1 to 64 characters from A-Z, a-z, 0-9, dot, underscore and hyphen.");
  }
  const kid = header.data;
  const outPath = assertOutsideRepo(options.outPath);

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (typeof jwk.x !== "string") throw new Error("Ed25519 public JWK is missing x.");

  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  try {
    // flag "wx": fails atomically if the file already exists.
    writeFileSync(outPath, pem, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Refusing to overwrite an existing file; choose a new key path.");
    }
    throw error;
  }

  return { kid, publicJwkX: jwk.x, trustSetEntry: { kid, x: jwk.x, status: "active" } };
}

/** Load an Ed25519 PKCS#8 PEM private key from a path outside the repository. */
export function loadPrivateKey(keyPath: string): KeyObject {
  const resolved = assertOutsideRepo(keyPath);
  const key = createPrivateKey(readFileSync(resolved));
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("The key is not an Ed25519 private key.");
  }
  return key;
}

export type IssueLicenceInput = {
  privateKey: KeyObject;
  kid: string;
  licenceId: string;
  issuedAt: Date;
  /** Defaults to issuedAt. */
  notBefore?: Date;
  expiresAt: Date;
  /** Grace in 24-hour days in UTC after expiresAt; default 14. */
  graceDays?: number;
  client: { id: string; name: string };
  deploymentId: string;
  timeZone: string;
  support: { renewalEmail: string; supportEmail: string; phone?: string; hours?: string };
};

export const DEFAULT_GRACE_DAYS = 14;

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} is not a valid date.`);
  }
}

/**
 * Build, validate and sign a licence. `graceEndsAt` is computed here as
 * `expiresAt` plus `graceDays` times 24 hours in UTC; the LMS never adds grace
 * itself (D-10, D-11). Every input is validated through the shared schemas
 * before anything is signed, so a bad input fails early.
 */
export function issueLicence(input: IssueLicenceInput): string {
  assertValidDate(input.issuedAt, "issuedAt");
  assertValidDate(input.expiresAt, "expiresAt");
  const notBeforeDate = input.notBefore ?? input.issuedAt;
  assertValidDate(notBeforeDate, "notBefore");

  if (input.expiresAt.getTime() <= input.issuedAt.getTime()) {
    throw new Error("expiresAt must be after issuedAt.");
  }
  const graceDays = input.graceDays ?? DEFAULT_GRACE_DAYS;
  if (!Number.isInteger(graceDays) || graceDays < 0) {
    throw new Error("graceDays must be a whole number of days, zero or more.");
  }

  const header = licenceHeaderSchema.parse({
    alg: "Ed25519",
    kid: input.kid,
    typ: "lms-licence",
    v: 1,
  });

  const graceEndsAt = new Date(input.expiresAt.getTime() + graceDays * DAY_MS);
  const support: Record<string, string> = {
    renewalEmail: input.support.renewalEmail,
    supportEmail: input.support.supportEmail,
  };
  if (input.support.phone) support.phone = input.support.phone;
  if (input.support.hours) support.hours = input.support.hours;

  const payload = licencePayloadSchema.parse({
    schemaVersion: 1,
    licenceId: input.licenceId,
    issuedAt: input.issuedAt.toISOString(),
    notBefore: notBeforeDate.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    graceEndsAt: graceEndsAt.toISOString(),
    client: { id: input.client.id, name: input.client.name },
    deploymentId: input.deploymentId,
    timeZone: input.timeZone,
    support,
  });

  return encodeLicenceEnvelope({
    header,
    payload,
    signature: (signedInput) => sign(null, Buffer.from(signedInput, "utf8"), input.privateKey),
  });
}

export type InspectedLicence = {
  /** Decoded WITHOUT verifying the signature: display only, never trust it. */
  header: unknown;
  payload: unknown;
  signatureBytes: number;
};

/** Decode a licence file's header and payload without verifying it. */
export function inspectLicence(raw: string): InspectedLicence {
  const envelope = parseEnvelope(raw);
  if (!envelope.ok) {
    throw new Error(
      envelope.code === "UNSUPPORTED_SCHEMA"
        ? "Unsupported licence schema prefix."
        : "Not a licence file (bad format).",
    );
  }
  try {
    return {
      header: JSON.parse(base64UrlDecode(envelope.headerB64).toString("utf8")) as unknown,
      payload: JSON.parse(base64UrlDecode(envelope.payloadB64).toString("utf8")) as unknown,
      signatureBytes: base64UrlDecode(envelope.signatureB64).length,
    };
  } catch {
    throw new Error("Not a licence file (undecodable header or payload).");
  }
}
