/**
 * Hourly licence check (Phase 14, plan 14-16; LIC-04, LIC-07, D-15, D-16).
 *
 * Mirrors `cleanup-notifications-task.ts`: a small injected-deps factory
 * (`createCheckLicenceTask`) for the RED/GREEN test cycle, plus a wired
 * singleton (`runCheckLicenceTask`) the Netlify scheduled function invokes.
 *
 * Each run calls `evaluateAndRecord({ source: "SCHEDULED" })`, which verifies
 * the stored licence locally (no network call, D-01), records a state or
 * outcome change exactly once, and returns the notice keys due for the
 * evaluated state. The task then emits those keys through the notice service.
 * Both halves are idempotent (the evaluation writes only on change and the
 * notice writer dedupes on a deterministic event id), so two runs inside one
 * hour create no duplicate event, audit row or notification.
 *
 * Log rule (T-14-16-03): the single log line carries the state code and counts
 * only, never licence text, key ids, client or contract detail.
 *
 * Closure rule (D-16): this file and everything it imports (`licence-service.ts`,
 * `licence-notice-service.ts`) must never import `next/headers`, the permission
 * layer, or `getCurrentActor`. `tests/boundary.test.ts` walks every file in
 * `netlify/functions/` and proves it.
 */

import type { LicenceStatusSnapshot } from "@/server/licence/types";
import { licenceNoticeService } from "@/server/services/licence-notice-service";
import { licenceService } from "@/server/services/licence-service";

export type CheckLicenceTaskDeps = {
  evaluateAndRecord: (options: { source: "SCHEDULED" }) => Promise<{
    snapshot: LicenceStatusSnapshot;
    transitions: readonly unknown[];
    noticeKeys: string[];
  }>;
  emitNotices: (input: {
    snapshot: LicenceStatusSnapshot;
    noticeKeys: string[];
  }) => Promise<{ created: string[]; skipped: string[] }>;
  log: (message: string) => void;
  now?: () => Date;
};

export function createCheckLicenceTask(deps: CheckLicenceTaskDeps) {
  return async function runCheckLicenceTask(): Promise<void> {
    const { snapshot, transitions, noticeKeys } = await deps.evaluateAndRecord({
      source: "SCHEDULED",
    });

    let created = 0;
    let skipped = 0;
    if (noticeKeys.length > 0) {
      const emitted = await deps.emitNotices({ snapshot, noticeKeys });
      created = emitted.created.length;
      skipped = emitted.skipped.length;
    }

    deps.log(
      `[scheduled] licence check: state=${snapshot.state} transitions=${transitions.length} notices=${created} skipped=${skipped}`,
    );
  };
}

export const runCheckLicenceTask = createCheckLicenceTask({
  evaluateAndRecord: (options) => licenceService.evaluateAndRecord(options),
  emitNotices: (input) => licenceNoticeService.emitNotices(input),
  log: (message) => console.info(message),
});
