/**
 * Database liveness probe for the public health endpoint (Phase 15, plan 15-06;
 * NFR-01, D-18, T-15-06-02).
 *
 * `pingDatabase(timeoutMs)` races a single `SELECT 1` against a timer and
 * answers a plain boolean: `true` when the query returns inside the bound,
 * `false` when it rejects or takes longer. It never throws, so the route can
 * map the answer straight to `ok` or `degraded`, and it never reports why the
 * ping failed (the route body must not leak error text, hosts or timing).
 *
 * The client is injected (`createHealthService`) so the integration test can
 * bind it to a Testcontainers database and a fake client can prove the
 * timeout path; `healthService` is bound to the app's Prisma singleton.
 *
 * A timed-out query is not cancelled: Prisma has no per-query abort. The race
 * has already attached handlers to it, so a late rejection is not unhandled.
 */

import { prisma } from "@/server/db";

/** The one Prisma method the probe needs; `PrismaClient` satisfies it. */
export type HealthClient = {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => PromiseLike<unknown>;
};

export type HealthServiceDeps = {
  client: HealthClient;
};

/** Fallback bound when a caller passes something that is not a positive finite number. */
const DEFAULT_TIMEOUT_MS = 2000;

export function createHealthService(deps: HealthServiceDeps) {
  async function pingDatabase(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    const bound = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), bound);
    });

    try {
      const query = Promise.resolve()
        .then(() => deps.client.$queryRaw`SELECT 1`)
        .then(
          () => true,
          () => false,
        );
      return await Promise.race([query, timeout]);
    } catch {
      return false;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  return { pingDatabase };
}

export const healthService = createHealthService({ client: prisma });
