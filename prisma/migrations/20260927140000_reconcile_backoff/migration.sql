-- F-03: per-row retry state for the payment reconciliation sweep.
ALTER TABLE "PaymentAttempt" ADD COLUMN "reconcileAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextReconcileAt" TIMESTAMP(3);

CREATE INDEX "PaymentAttempt_status_reconciledAt_nextReconcileAt_idx" ON "PaymentAttempt"("status", "reconciledAt", "nextReconcileAt");
