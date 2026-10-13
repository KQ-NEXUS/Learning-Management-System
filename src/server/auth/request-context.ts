/**
 * Request-scoped context for audit rows (NFR-07).
 *
 * `requestCorrelationId()` gives an audit row written during a request a
 * reference that ties it to the platform's request log: Netlify's
 * `x-nf-request-id` when the request carries one, otherwise a fresh random
 * UUID. Outside a request (a script, a worker, a test), `headers()` throws
 * and a random UUID is returned, so a caller never has to handle a missing
 * id.
 */

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";

export async function requestCorrelationId(): Promise<string> {
  try {
    const requestId = (await headers()).get("x-nf-request-id")?.trim();
    if (requestId) return requestId;
  } catch {
    // Not inside a request: fall through to a fresh id.
  }
  return randomUUID();
}
