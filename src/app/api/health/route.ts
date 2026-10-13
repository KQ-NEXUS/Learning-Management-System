/**
 * Public health endpoint for the external uptime monitor (Phase 15, plan 15-06;
 * NFR-01, D-18, T-15-06-01, T-15-06-02, T-15-06-04).
 *
 * `GET /api/health` answers `200 {"status":"ok"}` when a database `SELECT 1`
 * completes within 2 seconds and `503 {"status":"degraded"}` otherwise. `HEAD`
 * returns the same status with no body. Availability (NFR-01) is measured only
 * by the external monitor polling this route; the app never computes its own.
 *
 * - No input, no session, no auth: the monitor is anonymous.
 * - The body is one of two fixed values: no version, host name, stack, error
 *   text or timing ever reaches it.
 * - Deliberately no `dynamic`/`revalidate` route config: Route Handlers are not
 *   cached by default, and a cached answer could hide an outage.
 *   `Cache-Control: no-store` on every response is the explicit second layer.
 * - The route never touches Prisma directly; the probe lives in the health
 *   service. On an unexpected exception only the error name is logged.
 */

import { healthService } from "@/server/services/health-service";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The bound on the database ping, in milliseconds (NFR-01 research B13). */
const PING_TIMEOUT_MS = 2000;

type HealthStatus = "ok" | "degraded";

async function checkHealth(): Promise<HealthStatus> {
  try {
    return (await healthService.pingDatabase(PING_TIMEOUT_MS)) ? "ok" : "degraded";
  } catch (error) {
    console.error("[health] check failed", error instanceof Error ? error.name : "UnknownError");
    return "degraded";
  }
}

function statusCode(status: HealthStatus): number {
  return status === "ok" ? 200 : 503;
}

export async function GET(): Promise<Response> {
  const status = await checkHealth();
  return Response.json({ status }, { status: statusCode(status), headers: NO_STORE });
}

export async function HEAD(): Promise<Response> {
  const status = await checkHealth();
  return new Response(null, { status: statusCode(status), headers: NO_STORE });
}
