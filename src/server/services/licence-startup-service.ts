/**
 * Best-effort startup licence check (Phase 14, plan 14-16; LIC-04, T-14-16-01).
 *
 * `src/instrumentation.ts` calls this once per Node server instance. It runs the
 * same evaluation as the hourly scheduled task (`source: "STARTUP"`) and emits
 * the due notices, but it is strictly best effort:
 *
 * - it never throws: every error is caught and reported as `status: "error"`;
 * - it never delays boot by more than `timeoutMs` (default 3000): a race
 *   against a timer reports `status: "timeout"` and stops waiting (the
 *   evaluation may still finish in the background, its late result or
 *   rejection is discarded);
 * - it logs one line with the status and, for an error, only the error name
 *   (never a message, which could carry a connection string);
 * - it writes no audit row of its own. `evaluateAndRecord` audits only on a
 *   state or outcome change, so cold starts do not flood the audit trail.
 *
 * Nothing depends on this check running (assumption A3, adopted default OQ5):
 * whether a host runs `register()` on each cold start is not guaranteed, and
 * restriction is derived on every guarded write regardless.
 *
 * Closure rule (D-01): imports only licence services, never `next/*`, the
 * permission layer or `getCurrentActor`.
 */

import type { LicenceStatusSnapshot } from "@/server/licence/types";
import { licenceNoticeService } from "@/server/services/licence-notice-service";
import { licenceService } from "@/server/services/licence-service";

/** The hard bound on how long the startup check may hold up server boot. */
export const STARTUP_CHECK_TIMEOUT_MS = 3000;

export type LicenceStartupStatus = "ok" | "timeout" | "error";

export type LicenceStartupCheckDeps = {
  evaluateAndRecord: (options: { source: "STARTUP" }) => Promise<{
    snapshot: LicenceStatusSnapshot;
    transitions: readonly unknown[];
    noticeKeys: string[];
  }>;
  emitNotices: (input: {
    snapshot: LicenceStatusSnapshot;
    noticeKeys: string[];
  }) => Promise<{ created: string[]; skipped: string[] }>;
  log: (message: string) => void;
  timeoutMs?: number;
};

export async function runLicenceStartupCheck(
  deps: LicenceStartupCheckDeps,
): Promise<{ status: LicenceStartupStatus }> {
  const timeoutMs = deps.timeoutMs ?? STARTUP_CHECK_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let status: LicenceStartupStatus = "ok";
  let errorName: string | null = null;

  try {
    const work = (async () => {
      const { snapshot, noticeKeys } = await deps.evaluateAndRecord({ source: "STARTUP" });
      if (noticeKeys.length > 0) {
        await deps.emitNotices({ snapshot, noticeKeys });
      }
      return "ok" as const;
    })();
    // If the timeout wins the race, a later rejection must not become an
    // unhandled rejection that crashes the process.
    work.catch(() => undefined);

    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });

    status = await Promise.race([work, timeout]);
  } catch (error) {
    status = "error";
    errorName = error instanceof Error && error.name ? error.name : "UnknownError";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  try {
    deps.log(
      errorName === null
        ? `[startup] licence check: status=${status}`
        : `[startup] licence check: status=${status} error=${errorName}`,
    );
  } catch {
    // A failing logger must never turn a best-effort check into a boot failure.
  }

  return { status };
}

/** The wired startup check `src/instrumentation.ts` invokes. */
export function runStartupLicenceCheck(): Promise<{ status: LicenceStartupStatus }> {
  return runLicenceStartupCheck({
    evaluateAndRecord: (options) => licenceService.evaluateAndRecord(options),
    emitNotices: (input) => licenceNoticeService.emitNotices(input),
    log: (message) => console.info(message),
  });
}
