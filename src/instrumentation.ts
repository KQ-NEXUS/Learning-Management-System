/**
 * Next.js instrumentation hook (Phase 14, plan 14-16; LIC-04, T-14-16-01).
 *
 * Per the Next.js instrumentation guide
 * (`node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`),
 * `register` is called once when a new server instance is initiated and must
 * complete before the server is ready to handle requests. That is exactly why
 * the licence check here is best effort:
 *
 * - it runs only under the Node.js runtime (`process.env.NEXT_RUNTIME ===
 *   "nodejs"`); the Node-only licence services are imported dynamically inside
 *   the guard so the Edge runtime never loads them;
 * - it never blocks boot beyond the startup service's 3 second bound;
 * - it never throws: every error is swallowed, so a database or licence
 *   problem can never stop the server from starting.
 *
 * The guarded-write licence check does not depend on this hook (assumption A3):
 * whether a host runs `register()` on each cold start is not confirmed by
 * documentation, and restriction is derived on every guarded write anyway.
 * The hourly scheduled function (`netlify/functions/check-licence.ts`) is the
 * delivery path for alerts and transition audit rows.
 *
 * `onRequestError` (Phase 15, plan 15-06; NFR-07, D-18, T-15-06-03) writes one
 * JSON line per server error to the host log (Netlify function log), so an
 * error-rate change is visible without an error-tracking vendor. The line holds
 * only `event`, the route template (`routePath`, e.g. `/learn/[enrolmentId]`,
 * never the concrete path or query string), `routeType`, `method`, the error
 * name and the React/Next digest. The error message, request headers, cookies
 * and body are never read into it. Like `register`, it never throws.
 */

import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  try {
    const { runStartupLicenceCheck } = await import("@/server/services/licence-startup-service");
    await runStartupLicenceCheck();
  } catch {
    // Best effort by design: never let the licence check fail server startup.
  }
}

/** The error's own name when it is an Error, otherwise a fixed placeholder. */
function errorNameOf(error: unknown): string {
  return error instanceof Error && typeof error.name === "string" && error.name.length > 0
    ? error.name
    : "UnknownError";
}

/** The digest Next/React attaches to server errors, when one is present. */
function digestOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const { digest } = error as { digest: unknown };
    if (typeof digest === "string" || typeof digest === "number") {
      return String(digest);
    }
  }
  return undefined;
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  try {
    const line = {
      event: "request_error",
      routePath: context?.routePath,
      routeType: context?.routeType,
      method: request?.method,
      errorName: errorNameOf(error),
      digest: digestOf(error),
    };
    console.error(JSON.stringify(line));
  } catch {
    // Never let error reporting raise a second error.
  }
};
