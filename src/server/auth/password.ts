/**
 * Password hashing.
 *
 * PRD NFR-04 requires secure password hashing. This uses scrypt from Node's
 * standard library — memory-hard, in the platform, and no dependency to audit
 * or keep patched.
 *
 * Stored format: `scrypt$N$r$p$<saltHex>$<hashHex>`. The parameters travel
 * with the hash so they can be raised later without invalidating existing
 * passwords — verification reads them from the stored string rather than
 * assuming today's values.
 */

import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

// The explicit generics pick scrypt's options-taking overload, which
// promisify's inference collapses to the three-argument form.
const scryptAsync = promisify<string, Buffer, number, ScryptOptions, Buffer>(
  scrypt,
);

// OWASP's floor for scrypt: N >= 2^17, r = 8, p = 1.
const N = 131072;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("Password must not be empty.");

  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: 256 * 1024 * 1024,
  });

  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupted row
 * must fail closed, not surface a different error that distinguishes it from
 * a wrong password (IAM-06).
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scryptAsync(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  });

  return timingSafeEqual(derived, expected);
}
