-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN     "priceNgnMinor" INTEGER,
ADD COLUMN     "priceUsdMinor" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "baseAmountMinor" INTEGER,
ADD COLUMN     "gatewayFeeEstimateMinor" INTEGER,
ADD COLUMN     "gatewayFeeScheduleId" TEXT,
ADD COLUMN     "gatewayFeeScheduleVersion" INTEGER,
ADD COLUMN     "platformFeeMinor" INTEGER,
ADD COLUMN     "schoolSettlementExpectedMinor" INTEGER;

-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN     "gatewayFeeActualMinor" INTEGER,
ADD COLUMN     "platformGrossActualMinor" INTEGER,
ADD COLUMN     "platformNetActualMinor" INTEGER,
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "schoolSettlementActualMinor" INTEGER;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "baseComponentMinor" INTEGER,
ADD COLUMN     "gatewayComponentMinor" INTEGER,
ADD COLUMN     "platformComponentMinor" INTEGER,
ADD COLUMN     "providerOutcome" TEXT;

-- CreateTable
CREATE TABLE "GatewayFeeSchedule" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "currency" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "percentageBps" INTEGER NOT NULL,
    "fixedMinor" INTEGER NOT NULL,
    "waiverThresholdMinor" INTEGER,
    "capMinor" INTEGER,
    "taxBps" INTEGER NOT NULL DEFAULT 0,
    "roundingRule" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayFeeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GatewayFeeSchedule_provider_currency_active_effectiveFrom_idx" ON "GatewayFeeSchedule"("provider", "currency", "active", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayFeeSchedule_provider_currency_version_key" ON "GatewayFeeSchedule"("provider", "currency", "version");

-- Manual paste-in from prisma/sql/004_payment_split_integrity.sql — the
-- non-negative CHECK constraints Prisma's schema language cannot express
-- (Phase 7, D-24). Regression proof: tests/schema-payment-split.test.ts.

-- D-06/D-08 — Cohort's two independent base prices are never negative.
ALTER TABLE "Cohort"
  ADD CONSTRAINT cohort_price_ngn_minor_non_negative
  CHECK ("priceNgnMinor" IS NULL OR "priceNgnMinor" >= 0);

ALTER TABLE "Cohort"
  ADD CONSTRAINT cohort_price_usd_minor_non_negative
  CHECK ("priceUsdMinor" IS NULL OR "priceUsdMinor" >= 0);

-- D-11 — GatewayFeeSchedule's monetary columns and basis-point/version ranges.
ALTER TABLE "GatewayFeeSchedule"
  ADD CONSTRAINT gateway_fee_schedule_fixed_minor_non_negative
  CHECK ("fixedMinor" >= 0);

ALTER TABLE "GatewayFeeSchedule"
  ADD CONSTRAINT gateway_fee_schedule_waiver_threshold_minor_non_negative
  CHECK ("waiverThresholdMinor" IS NULL OR "waiverThresholdMinor" >= 0);

ALTER TABLE "GatewayFeeSchedule"
  ADD CONSTRAINT gateway_fee_schedule_cap_minor_non_negative
  CHECK ("capMinor" IS NULL OR "capMinor" >= 0);

ALTER TABLE "GatewayFeeSchedule"
  ADD CONSTRAINT gateway_fee_schedule_percentage_bps_range
  CHECK ("percentageBps" >= 0 AND "percentageBps" <= 10000);

ALTER TABLE "GatewayFeeSchedule"
  ADD CONSTRAINT gateway_fee_schedule_tax_bps_range
  CHECK ("taxBps" >= 0 AND "taxBps" <= 10000);

ALTER TABLE "GatewayFeeSchedule"
  ADD CONSTRAINT gateway_fee_schedule_version_positive
  CHECK ("version" >= 1);

-- D-13 — Order's snapshot columns are never negative.
ALTER TABLE "Order"
  ADD CONSTRAINT order_base_amount_minor_non_negative
  CHECK ("baseAmountMinor" IS NULL OR "baseAmountMinor" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT order_platform_fee_minor_non_negative
  CHECK ("platformFeeMinor" IS NULL OR "platformFeeMinor" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT order_gateway_fee_estimate_minor_non_negative
  CHECK ("gatewayFeeEstimateMinor" IS NULL OR "gatewayFeeEstimateMinor" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT order_school_settlement_expected_minor_non_negative
  CHECK ("schoolSettlementExpectedMinor" IS NULL OR "schoolSettlementExpectedMinor" >= 0);

-- D-14 — PaymentAttempt's actual-settlement columns are never negative; they
-- stay NULL (never 0) until verified provider evidence arrives.
ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT payment_attempt_gateway_fee_actual_minor_non_negative
  CHECK ("gatewayFeeActualMinor" IS NULL OR "gatewayFeeActualMinor" >= 0);

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT payment_attempt_school_settlement_actual_minor_non_negative
  CHECK ("schoolSettlementActualMinor" IS NULL OR "schoolSettlementActualMinor" >= 0);

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT payment_attempt_platform_gross_actual_minor_non_negative
  CHECK ("platformGrossActualMinor" IS NULL OR "platformGrossActualMinor" >= 0);

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT payment_attempt_platform_net_actual_minor_non_negative
  CHECK ("platformNetActualMinor" IS NULL OR "platformNetActualMinor" >= 0);

-- D-22 — Refund's component-allocation columns are never negative.
ALTER TABLE "Refund"
  ADD CONSTRAINT refund_base_component_minor_non_negative
  CHECK ("baseComponentMinor" IS NULL OR "baseComponentMinor" >= 0);

ALTER TABLE "Refund"
  ADD CONSTRAINT refund_platform_component_minor_non_negative
  CHECK ("platformComponentMinor" IS NULL OR "platformComponentMinor" >= 0);

ALTER TABLE "Refund"
  ADD CONSTRAINT refund_gateway_component_minor_non_negative
  CHECK ("gatewayComponentMinor" IS NULL OR "gatewayComponentMinor" >= 0);

-- D-08 — backfill the legacy priceMinor/currency pair into the matching new
-- currency rail for every pre-existing Cohort, leaving the OTHER rail NULL
-- (never 0 — NULL means "not offered", 0 would mean "free").
UPDATE "Cohort"
  SET "priceNgnMinor" = "priceMinor"
  WHERE upper("currency") = 'NGN' AND "priceNgnMinor" IS NULL;

UPDATE "Cohort"
  SET "priceUsdMinor" = "priceMinor"
  WHERE upper("currency") = 'USD' AND "priceUsdMinor" IS NULL;
