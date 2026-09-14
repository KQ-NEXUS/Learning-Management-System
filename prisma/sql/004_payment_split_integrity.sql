-- Integrity constraints Prisma's schema language cannot express, Phase 7.
--
-- Paste this into the migration generated for the dual-currency,
-- gateway-fee-schedule, order-snapshot, actual-settlement and
-- refund-allocation schema delta before applying it.
--
-- D-24 — every new monetary column added in this plan rejects a negative
-- value at the database level, so a calculation bug in application code can
-- never persist impossible money. This is a superset of the plan's own
-- eleven-column enumeration (Order's four + PaymentAttempt's four + Refund's
-- three): the must-have truth "the database itself rejects a negative value
-- in every new monetary column" also covers GatewayFeeSchedule's fixedMinor,
-- waiverThresholdMinor and capMinor, so those three are included here too
-- (Rule 2 — missing critical functionality the plan's own truth requires).
--
-- Like 003_cohort_operations.sql, every constraint below has a regression
-- test — tests/schema-payment-split.test.ts — asserting the constraint name
-- appears in an applied migration.sql AND that it rejects a bad row against
-- real Postgres.

-- ---------------------------------------------------------------------------
-- 1. Cohort's two independent base prices are never negative
-- ---------------------------------------------------------------------------
-- D-06/D-08. NULL means "this rail is not offered"; a negative price is
-- meaningless in either case.

ALTER TABLE "Cohort"
  ADD CONSTRAINT cohort_price_ngn_minor_non_negative
  CHECK ("priceNgnMinor" IS NULL OR "priceNgnMinor" >= 0);

ALTER TABLE "Cohort"
  ADD CONSTRAINT cohort_price_usd_minor_non_negative
  CHECK ("priceUsdMinor" IS NULL OR "priceUsdMinor" >= 0);

-- ---------------------------------------------------------------------------
-- 2. GatewayFeeSchedule's monetary columns and basis-point/version ranges
-- ---------------------------------------------------------------------------
-- D-11. Basis points outside 0..10000 (0%..100%) are not a valid fee rate or
-- tax rate. version below 1 would break the "new version row" immutability
-- model these rows exist to guarantee.

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

-- ---------------------------------------------------------------------------
-- 3. Order's D-13 snapshot columns are never negative
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 4. PaymentAttempt's D-14 actual-settlement columns are never negative
-- ---------------------------------------------------------------------------
-- These stay NULL (never 0) until verified provider evidence arrives; the
-- CHECK only rejects a negative once a value is actually written.

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

-- ---------------------------------------------------------------------------
-- 5. Refund's D-22 component-allocation columns are never negative
-- ---------------------------------------------------------------------------

ALTER TABLE "Refund"
  ADD CONSTRAINT refund_base_component_minor_non_negative
  CHECK ("baseComponentMinor" IS NULL OR "baseComponentMinor" >= 0);

ALTER TABLE "Refund"
  ADD CONSTRAINT refund_platform_component_minor_non_negative
  CHECK ("platformComponentMinor" IS NULL OR "platformComponentMinor" >= 0);

ALTER TABLE "Refund"
  ADD CONSTRAINT refund_gateway_component_minor_non_negative
  CHECK ("gatewayComponentMinor" IS NULL OR "gatewayComponentMinor" >= 0);
