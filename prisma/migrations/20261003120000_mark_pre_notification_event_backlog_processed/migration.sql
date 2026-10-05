-- A-14 — DomainEvent rows were written by phases 5-12 long before anything
-- consumed them. The phase 13 drain claims every row whose processedAt is
-- NULL, oldest first, with no age limit, so its first run would email and
-- notify learners about every historic event (cohort cancellations,
-- withdrawals, grades) at once.
--
-- Mark that backlog as processed without sending. Only rows older than one
-- hour are touched: on a first deploy that is the whole backlog, while on a
-- database where the drain already runs every minute the still-pending rows
-- are newer than that and are left for the drain.
--
-- lastError stays NULL on purpose: processedAt + lastError together mean a
-- poison-marked event (D-04), which these are not.
UPDATE "DomainEvent"
SET "processedAt" = CURRENT_TIMESTAMP
WHERE "processedAt" IS NULL
  AND "occurredAt" < CURRENT_TIMESTAMP - INTERVAL '1 hour';
