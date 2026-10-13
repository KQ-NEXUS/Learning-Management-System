/**
 * Read-only data integrity checks (Phase 15, plan 15-07; NFR-14).
 *
 * Each check is one SELECT that returns the ids of records breaking a business
 * invariant the schema cannot fully enforce on its own. Together with the
 * existing foreign keys, unique and partial unique indexes, CHECK constraints
 * and the transactional integration tests, these checks are the reconciliation
 * evidence for enrolment, payment, grading, completion and credential records.
 * No other invariant is claimed.
 *
 * Consumers:
 *   - `scripts/ops/integrity-checks.ts` (CLI; runs after the database-target
 *     guard, used by the restore rehearsal and the local and staging runs);
 *   - the staff Operations status page, section "Data integrity checks"
 *     (plan 15-13), which shows each label with "Passed" or a count.
 *
 * Rules:
 *   - SELECT (or WITH ... SELECT) only. A check reports; it never repairs data.
 *     `tests/integrity-checks.integration.test.ts` asserts the SQL text.
 *   - Each check runs on its own: a failing query is reported as status
 *     "error" for that check and the remaining checks still run.
 *   - Results carry opaque record ids only (at most 20 per check), never names,
 *     emails or amounts.
 *   - The SQL is static text with no interpolated input, which is why the
 *     `$queryRawUnsafe` form is acceptable here: nothing user-supplied ever
 *     reaches it.
 *
 * Shape follows `src/server/scheduled/release-expired-holds-task.ts`
 * (dependency-injected factory with a `log` dependency) and
 * `email-delivery-log-service.ts` (factory plus a singleton bound to prisma).
 */

import { prisma } from "@/server/db";

export type IntegrityCheckDefinition = {
  /** Stable identifier used by the CLI output, tests and the ops page. */
  id: string;
  /** Plain-words name shown on the ops page (UI-SPEC S1 section 5). */
  label: string;
  /** A SELECT returning one row per violating record, with a text column `id`. */
  sql: string;
};

export type IntegrityCheckStatus = "passed" | "violations" | "error";

export type IntegrityCheckResult = {
  id: string;
  label: string;
  status: IntegrityCheckStatus;
  violationCount: number;
  /** Up to INTEGRITY_SAMPLE_LIMIT ids, sorted, for a human to look up. */
  sampleIds: string[];
};

export const INTEGRITY_SAMPLE_LIMIT = 20;

/** Order statuses that mean money was taken at some point. A refund (full or
 * partial) does not undo the original payment, and a refund may retain the
 * learner's access, so all three count as "paid". */
const PAID_ORDER_STATUSES = `('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')`;

/** Enrolment statuses covered by the one-live-enrolment partial unique index
 * (migration 20260919120000_enrolment_one_live_per_learner_cohort). */
const LIVE_ENROLMENT_STATUSES = `('ACTIVE', 'COMPLETED')`;

export const INTEGRITY_CHECKS: readonly IntegrityCheckDefinition[] = [
  {
    // Every provider, including the staff manual confirmation (PAY-03), ends
    // in a PaymentAttempt with status SUCCEEDED: manual confirmation goes
    // through activateOrderAsSystem, which records the MANUAL attempt as
    // SUCCEEDED. So "successful payment" is any SUCCEEDED attempt.
    id: "paid-order-has-successful-payment",
    label: "Paid orders have a successful payment",
    sql: `
      SELECT o.id::text AS id
      FROM "Order" o
      WHERE o.status IN ${PAID_ORDER_STATUSES}
        AND NOT EXISTS (
          SELECT 1 FROM "PaymentAttempt" pa
          WHERE pa."orderId" = o.id AND pa.status = 'SUCCEEDED'
        )
    `,
  },
  {
    // An enrolment with no order was created by staff directly and is out of
    // scope. One linked to an order must have been paid before it went ACTIVE.
    id: "active-enrolment-has-paid-order",
    label: "Active enrolments have a paid order",
    sql: `
      SELECT e.id::text AS id
      FROM "Enrolment" e
      JOIN "Order" o ON o.id = e."orderId"
      WHERE e.status = 'ACTIVE'
        AND o.status NOT IN ${PAID_ORDER_STATUSES}
    `,
  },
  {
    // "Live" matches the partial unique index from migration
    // 20260919120000_enrolment_one_live_per_learner_cohort: ACTIVE or
    // COMPLETED. Every enrolment in a duplicated pair is reported.
    id: "one-live-enrolment-per-learner-cohort",
    label: "One live enrolment per learner and cohort",
    sql: `
      SELECT e.id::text AS id
      FROM "Enrolment" e
      JOIN (
        SELECT "userId", "cohortId"
        FROM "Enrolment"
        WHERE status IN ${LIVE_ENROLMENT_STATUSES}
        GROUP BY "userId", "cohortId"
        HAVING count(*) > 1
      ) d ON d."userId" = e."userId" AND d."cohortId" = e."cohortId"
      WHERE e.status IN ${LIVE_ENROLMENT_STATUSES}
    `,
  },
  {
    // Open means supersededAt IS NULL. courseId is null for programme scope,
    // so it is compared through COALESCE.
    id: "one-open-completion-per-enrolment-course",
    label: "One open completion record per enrolment and course",
    sql: `
      SELECT cr.id::text AS id
      FROM "CompletionRecord" cr
      JOIN (
        SELECT "enrolmentId", scope, COALESCE("courseId", '') AS course_key
        FROM "CompletionRecord"
        WHERE "supersededAt" IS NULL
        GROUP BY "enrolmentId", scope, COALESCE("courseId", '')
        HAVING count(*) > 1
      ) d ON d."enrolmentId" = cr."enrolmentId"
         AND d.scope = cr.scope
         AND d.course_key = COALESCE(cr."courseId", '')
      WHERE cr."supersededAt" IS NULL
    `,
  },
  {
    // Quiz grades hang off an attempt and have no submission; only
    // submission-backed grades are compared.
    id: "one-grade-per-submission",
    label: "One grade per submission",
    sql: `
      SELECT g.id::text AS id
      FROM "Grade" g
      JOIN (
        SELECT "submissionId"
        FROM "Grade"
        WHERE "submissionId" IS NOT NULL
        GROUP BY "submissionId"
        HAVING count(*) > 1
      ) d ON d."submissionId" = g."submissionId"
    `,
  },
  {
    // Issuance requires an open completion record for the same enrolment and
    // scope (certificate-service.ts). A record superseded later still counts
    // here: that case is the CRD-06 review flag's job, not a missing record.
    id: "active-certificate-has-completion",
    label: "Active certificates have a completion record",
    sql: `
      SELECT c.id::text AS id
      FROM "Certificate" c
      WHERE c.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM "CompletionRecord" cr
          WHERE cr."enrolmentId" = c."enrolmentId" AND cr.scope = c.scope
        )
    `,
  },
  {
    // Counts live enrolments (ACTIVE or COMPLETED, the statuses that keep
    // their seat) against Cohort.capacity. Seat holds are already bounded by
    // the cohort_capacity_not_exceeded CHECK on seatsTaken.
    id: "cohort-within-capacity",
    label: "Cohorts are within capacity",
    sql: `
      SELECT co.id::text AS id
      FROM "Cohort" co
      JOIN (
        SELECT "cohortId", count(*) AS live
        FROM "Enrolment"
        WHERE status IN ${LIVE_ENROLMENT_STATUSES}
        GROUP BY "cohortId"
      ) e ON e."cohortId" = co.id
      WHERE e.live > co.capacity
    `,
  },
];

type QueryClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type IntegrityCheckServiceDeps = {
  client: QueryClient;
  /** Receives a one-line diagnostic when a check's query fails. */
  log?: (message: string) => void;
  /** Override for tests; defaults to INTEGRITY_CHECKS. */
  checks?: readonly IntegrityCheckDefinition[];
};

type SummaryRow = { violationCount: number | bigint | null; sampleIds: string[] | null };

/** Wraps a check's SELECT so the database returns the count and a bounded,
 * sorted sample in one round trip, instead of shipping every violating id. */
function summarySql(checkSql: string): string {
  return `
    WITH violations AS (${checkSql})
    SELECT
      (SELECT count(*) FROM violations)::int AS "violationCount",
      ARRAY(
        SELECT v.id FROM violations v ORDER BY v.id LIMIT ${INTEGRITY_SAMPLE_LIMIT}
      ) AS "sampleIds"
  `;
}

export function createIntegrityCheckService(deps: IntegrityCheckServiceDeps) {
  const checks = deps.checks ?? INTEGRITY_CHECKS;
  const log = deps.log ?? (() => {});

  async function runCheck(check: IntegrityCheckDefinition): Promise<IntegrityCheckResult> {
    try {
      const rows = await deps.client.$queryRawUnsafe<SummaryRow[]>(summarySql(check.sql));
      const row = rows[0];
      const violationCount = Number(row?.violationCount ?? 0);
      const sampleIds = (row?.sampleIds ?? []).slice(0, INTEGRITY_SAMPLE_LIMIT);
      return {
        id: check.id,
        label: check.label,
        status: violationCount === 0 ? "passed" : "violations",
        violationCount,
        sampleIds,
      };
    } catch (error) {
      log(
        `[integrity] check ${check.id} failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`,
      );
      return { id: check.id, label: check.label, status: "error", violationCount: 0, sampleIds: [] };
    }
  }

  return {
    /** Runs every check one after another; never throws for a failing check. */
    async runIntegrityChecks(): Promise<IntegrityCheckResult[]> {
      const results: IntegrityCheckResult[] = [];
      for (const check of checks) {
        results.push(await runCheck(check));
      }
      return results;
    },
  };
}

export const integrityCheckService = createIntegrityCheckService({
  client: prisma,
  log: (message) => console.error(message),
});
