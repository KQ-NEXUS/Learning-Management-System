import { createHash } from "node:crypto";

/**
 * F-14a — bearer tokens (session cookies, verification / reset / email-change
 * links) are stored only as their SHA-256 hex digest. The raw value lives only
 * in the cookie or the email; a database or backup read yields nothing that
 * works as a session or a link. Every write and every lookup goes through
 * this one function, and the `hash_bearer_tokens` migration applies the same
 * digest in SQL to rows that existed before, so nobody is signed out.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
