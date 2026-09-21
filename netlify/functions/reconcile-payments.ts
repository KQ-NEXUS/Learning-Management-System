import type { Config } from "@netlify/functions";
import { runReconcilePaymentsTask } from "../../src/server/scheduled/reconcile-payments-task";

export function createReconcilePaymentsHandler(run: () => Promise<void>) {
  return async function reconcilePayments(): Promise<void> {
    await run();
  };
}

export default createReconcilePaymentsHandler(runReconcilePaymentsTask);

/**
 * 07-07 — every 15 minutes, looser than the 5-minute hold sweep
 * (`release-expired-holds.ts`). This is Claude's own discretion under
 * CONTEXT.md's third agent-discretion bullet and 07-RESEARCH.md's
 * Assumption A5: reconciliation is lower-urgency than the hold sweep because
 * D-14 and D-18 already treat a NULL actual-settlement value as the normal
 * state for a fresh payment, not an error condition needing fast recovery.
 */
export const config: Config = {
  schedule: "*/15 * * * *",
};
