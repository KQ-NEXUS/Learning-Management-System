/**
 * Certificate references cannot reuse the 8-hex-character order-reference
 * suffix: that carries only 32 bits of entropy, while public verification has
 * no rate limiting. Sixteen random bytes preserve the prefix convention while
 * making unauthenticated enumeration computationally infeasible.
 */

import { randomBytes } from "node:crypto";

export function generateVerificationRef(): string {
  return `CERT-${randomBytes(16).toString("hex").toUpperCase()}`;
}
