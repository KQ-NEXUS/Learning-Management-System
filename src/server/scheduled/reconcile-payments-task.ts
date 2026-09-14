import { reconcilePaymentsAsSystem } from "@/server/services/payment-reconciliation-service";

/**
 * 07-07 — mirrors `HOLD_SWEEP_BATCH_SIZE`'s convention exactly. Reconciliation
 * is lower-urgency than the 5-minute hold sweep (D-14/D-18 already treat a
 * NULL actual value as the normal state for a fresh payment), so a smaller
 * per-invocation bound at a looser cadence (see `Config.schedule` in
 * `netlify/functions/reconcile-payments.ts`) is enough to drain a realistic
 * backlog without a long-running transaction.
 */
export const RECONCILE_PAYMENTS_BATCH_SIZE = 25;

export type ReconcilePaymentsTaskDeps = {
  reconcilePayments: (
    batchLimit: number,
  ) => Promise<{ reconciled: number; failed: number }>;
  log: (message: string) => void;
};

export function createReconcilePaymentsTask(deps: ReconcilePaymentsTaskDeps) {
  return async function runReconcilePaymentsTask(): Promise<void> {
    const result = await deps.reconcilePayments(RECONCILE_PAYMENTS_BATCH_SIZE);
    deps.log(
      `[scheduled] reconciled ${result.reconciled} payment attempts; ${result.failed} failed`,
    );
  };
}

export const runReconcilePaymentsTask = createReconcilePaymentsTask({
  reconcilePayments: reconcilePaymentsAsSystem,
  log: (message) => console.info(message),
});
