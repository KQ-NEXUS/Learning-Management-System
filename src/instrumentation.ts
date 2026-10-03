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
 */

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
