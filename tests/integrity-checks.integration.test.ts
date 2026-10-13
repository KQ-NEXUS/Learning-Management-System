/**
 * Real-Postgres proof for the NFR-14 integrity checks (plan 15-07, Task 2).
 *
 * Proves four things about `src/server/services/integrity-check-service.ts`:
 *   1. a freshly migrated database with a small, valid fixture set reports
 *      "passed" with zero violations for all seven checks;
 *   2. one inserted violation per check makes exactly that check report
 *      "violations" with the inserted id in its sample, and leaves every other
 *      check passed;
 *   3. a check whose SQL is broken reports "error" while the other checks
 *      still return results;
 *   4. every check's SQL is read-only text (SELECT or WITH, no INSERT, UPDATE
 *      or DELETE).
 *
 * Each violation is inserted inside an interactive transaction that is always
 * rolled back, so the cases cannot leak into each other. Where a database
 * unique index already prevents the violation, that index is dropped INSIDE
 * the same transaction first (Postgres DDL is transactional, so the rollback
 * restores it); the check exists for data written before the index, or for a
 * restored copy whose indexes were not rebuilt.
 *
 * SAFETY: the only database here is a disposable Testcontainers instance from
 * `startTestDatabase()`. Nothing reads `.env` or reaches a shared database.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error, which is the expected failure mode, not a code bug.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import {
  seedCohortFixture,
  seedEnrolmentFixture,
  seedLearnerFixture,
} from "./support/cohort-fixtures";
import {
  createIntegrityCheckService,
  INTEGRITY_CHECKS,
  INTEGRITY_SAMPLE_LIMIT,
  type IntegrityCheckResult,
} from "@/server/services/integrity-check-service";

type Tx = Prisma.TransactionClient;

let db: TestDatabase;
let counter = 0;
const uniq = (prefix: string) => `${prefix}-${++counter}`;

/** Ids of the valid fixture set, reused by the violation cases. */
const fx = {
  cohortId: "",
  courseId: "",
  paidEnrolmentId: "",
  paidUserId: "",
  staffEnrolmentId: "",
  staffUserId: "",
  completedEnrolmentId: "",
  submissionId: "",
  assessmentId: "",
};

async function createOrder(tx: Tx | TestDatabase["prisma"], userId: string, status: string) {
  const order = await tx.order.create({
    data: {
      reference: uniq("ORD-IT"),
      userId,
      cohortId: fx.cohortId,
      amountMinor: 10_000,
      currency: "NGN",
      status: status as never,
      idempotencyKey: uniq("order-key"),
    },
    select: { id: true },
  });
  return order.id;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const prisma = db.prisma;

  const { cohortId, courseId } = await seedCohortFixture(prisma, { capacity: 5, status: "PUBLISHED" });
  fx.cohortId = cohortId;
  fx.courseId = courseId;

  // A paid enrolment: PAID order with a SUCCEEDED attempt.
  const paidLearner = await seedLearnerFixture(prisma);
  fx.paidUserId = paidLearner.userId;
  const paidOrderId = await createOrder(prisma, paidLearner.userId, "PAID");
  await prisma.paymentAttempt.create({
    data: {
      orderId: paidOrderId,
      provider: "PAYSTACK",
      amountMinor: 10_000,
      currency: "NGN",
      status: "SUCCEEDED",
      idempotencyKey: uniq("attempt-key"),
      confirmedAt: new Date(),
    },
  });
  fx.paidEnrolmentId = (
    await seedEnrolmentFixture(prisma, { cohortId, userId: paidLearner.userId, orderId: paidOrderId })
  ).enrolmentId;

  // A manually confirmed, partly refunded order also counts as paid.
  const manualLearner = await seedLearnerFixture(prisma);
  const manualOrderId = await createOrder(prisma, manualLearner.userId, "PARTIALLY_REFUNDED");
  await prisma.paymentAttempt.create({
    data: {
      orderId: manualOrderId,
      provider: "MANUAL",
      amountMinor: 10_000,
      currency: "NGN",
      status: "SUCCEEDED",
      idempotencyKey: uniq("attempt-key"),
      confirmedAt: new Date(),
      manualChannel: "BANK_TRANSFER",
      manualReference: "TRF-1",
      reason: "Paid at the office",
    },
  });
  await seedEnrolmentFixture(prisma, { cohortId, userId: manualLearner.userId, orderId: manualOrderId });

  // A staff-created enrolment with no order at all (allowed).
  const staffEnrolment = await seedEnrolmentFixture(prisma, { cohortId });
  fx.staffEnrolmentId = staffEnrolment.enrolmentId;
  fx.staffUserId = staffEnrolment.userId;

  // An unpaid order with a withdrawn enrolment (not live, so not a violation).
  const withdrawnLearner = await seedLearnerFixture(prisma);
  const pendingOrderId = await createOrder(prisma, withdrawnLearner.userId, "PENDING");
  await seedEnrolmentFixture(prisma, {
    cohortId,
    userId: withdrawnLearner.userId,
    status: "WITHDRAWN",
    orderId: pendingOrderId,
  });

  // A completed enrolment with one open completion record, one superseded
  // record and an ACTIVE certificate.
  const completed = await seedEnrolmentFixture(prisma, { cohortId, status: "COMPLETED" });
  fx.completedEnrolmentId = completed.enrolmentId;
  await prisma.completionRecord.create({
    data: {
      enrolmentId: completed.enrolmentId,
      scope: "COURSE",
      courseId,
      ruleVersion: 1,
      supersededAt: new Date(Date.now() - 86_400_000),
    },
  });
  await prisma.completionRecord.create({
    data: { enrolmentId: completed.enrolmentId, scope: "COURSE", courseId, ruleVersion: 2 },
  });
  await prisma.certificate.create({
    data: {
      verificationRef: uniq("CERT-IT"),
      enrolmentId: completed.enrolmentId,
      userId: completed.userId,
      scope: "COURSE",
      courseId,
      awardTitle: "Integrity Course",
      learnerName: "Fixture Learner",
      status: "ACTIVE",
    },
  });

  // One graded submission.
  const assessment = await prisma.assessment.create({
    data: { courseId, type: "ASSIGNMENT", title: "Integrity assignment" },
    select: { id: true },
  });
  fx.assessmentId = assessment.id;
  const submission = await prisma.submission.create({
    data: {
      assessmentId: assessment.id,
      enrolmentId: fx.paidEnrolmentId,
      versionUsed: 1,
      storageKey: "fixtures/integrity.pdf",
      filename: "integrity.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1_000,
    },
    select: { id: true },
  });
  fx.submissionId = submission.id;
  await prisma.grade.create({
    data: {
      assessmentId: assessment.id,
      enrolmentId: fx.paidEnrolmentId,
      submissionId: submission.id,
      score: 80,
      maxScore: 100,
    },
  });
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await db?.stop();
}, TEST_DB_TIMEOUT_MS);

class Rollback extends Error {}

/** Inserts a violation, runs every check on the same transaction, then rolls
 * the whole thing back (including any dropped index). */
async function runWithViolation(
  insert: (tx: Tx) => Promise<string>,
): Promise<{ insertedId: string; results: IntegrityCheckResult[] }> {
  let captured: { insertedId: string; results: IntegrityCheckResult[] } | undefined;
  try {
    await db.prisma.$transaction(
      async (tx) => {
        const insertedId = await insert(tx);
        const results = await createIntegrityCheckService({ client: tx }).runIntegrityChecks();
        captured = { insertedId, results };
        throw new Rollback();
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  if (!captured) throw new Error("violation case did not run");
  return captured;
}

/** Drops every unique index on `table` that covers `column` (never the
 * primary key), inside the caller's transaction. */
async function dropUniqueIndexes(tx: Tx, table: string, column: string): Promise<void> {
  const rows = await tx.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = current_schema() AND tablename = $1
       AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE $2`,
    table,
    `%"${column}"%`,
  );
  for (const row of rows) {
    await tx.$executeRawUnsafe(`DROP INDEX "${row.indexname.replace(/"/g, '""')}"`);
  }
}

function byId(results: IntegrityCheckResult[]): Map<string, IntegrityCheckResult> {
  return new Map(results.map((result) => [result.id, result]));
}

function expectOnlyViolation(results: IntegrityCheckResult[], checkId: string, insertedId: string) {
  const map = byId(results);
  expect(map.size).toBe(INTEGRITY_CHECKS.length);
  const target = map.get(checkId);
  expect(target, `check ${checkId} exists`).toBeDefined();
  expect(target!.status).toBe("violations");
  expect(target!.violationCount).toBeGreaterThan(0);
  expect(target!.sampleIds).toContain(insertedId);
  for (const result of results) {
    if (result.id === checkId) continue;
    expect({ id: result.id, status: result.status, violationCount: result.violationCount }).toEqual({
      id: result.id,
      status: "passed",
      violationCount: 0,
    });
  }
}

describe("integrity check definitions (static)", () => {
  it("has exactly seven checks with unique ids and labels", () => {
    expect(INTEGRITY_CHECKS).toHaveLength(7);
    expect(new Set(INTEGRITY_CHECKS.map((check) => check.id)).size).toBe(7);
    expect(new Set(INTEGRITY_CHECKS.map((check) => check.label)).size).toBe(7);
  });

  it.each(INTEGRITY_CHECKS.map((check) => [check.id, check.sql] as const))(
    "%s is read-only SQL",
    (_id, sql) => {
      expect(sql.trim()).toMatch(/^(SELECT|WITH)\b/i);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|COPY)\b/i);
      expect(sql).not.toContain(";");
    },
  );
});

describe("integrity checks against a real database", () => {
  it(
    "reports every check passed with zero violations on a valid fixture set",
    async () => {
      const results = await createIntegrityCheckService({ client: db.prisma }).runIntegrityChecks();
      expect(results.map((result) => result.id)).toEqual(INTEGRITY_CHECKS.map((check) => check.id));
      for (const result of results) {
        expect(result).toEqual({
          id: result.id,
          label: result.label,
          status: "passed",
          violationCount: 0,
          sampleIds: [],
        });
      }
    },
    TEST_DB_TIMEOUT_MS,
  );

  it("paid order without a successful payment", async () => {
    const { insertedId, results } = await runWithViolation(async (tx) => {
      const learner = await tx.user.create({
        data: { email: `${uniq("v1")}@fixture.test`, name: "V1", status: "ACTIVE" },
      });
      const orderId = await createOrder(tx, learner.id, "PAID");
      // A failed attempt is not a successful payment.
      await tx.paymentAttempt.create({
        data: {
          orderId,
          provider: "STRIPE",
          amountMinor: 10_000,
          currency: "NGN",
          status: "FAILED",
          idempotencyKey: uniq("attempt-key"),
        },
      });
      return orderId;
    });
    expectOnlyViolation(results, "paid-order-has-successful-payment", insertedId);
  });

  it("active enrolment whose order is not paid", async () => {
    const { insertedId, results } = await runWithViolation(async (tx) => {
      const learner = await tx.user.create({
        data: { email: `${uniq("v2")}@fixture.test`, name: "V2", status: "ACTIVE" },
      });
      const orderId = await createOrder(tx, learner.id, "PENDING");
      const enrolment = await tx.enrolment.create({
        data: { cohortId: fx.cohortId, userId: learner.id, status: "ACTIVE", orderId },
      });
      return enrolment.id;
    });
    expectOnlyViolation(results, "active-enrolment-has-paid-order", insertedId);
  });

  it("more than one live enrolment per learner and cohort", async () => {
    const { insertedId, results } = await runWithViolation(async (tx) => {
      await dropUniqueIndexes(tx, "Enrolment", "userId");
      const duplicate = await tx.enrolment.create({
        data: { cohortId: fx.cohortId, userId: fx.staffUserId, status: "COMPLETED" },
      });
      return duplicate.id;
    });
    expectOnlyViolation(results, "one-live-enrolment-per-learner-cohort", insertedId);
    expect(byId(results).get("one-live-enrolment-per-learner-cohort")!.sampleIds).toContain(fx.staffEnrolmentId);
  });

  it("more than one open completion record per enrolment, scope and course", async () => {
    const { insertedId, results } = await runWithViolation(async (tx) => {
      await dropUniqueIndexes(tx, "CompletionRecord", "enrolmentId");
      const duplicate = await tx.completionRecord.create({
        data: { enrolmentId: fx.completedEnrolmentId, scope: "COURSE", courseId: fx.courseId, ruleVersion: 3 },
      });
      return duplicate.id;
    });
    expectOnlyViolation(results, "one-open-completion-per-enrolment-course", insertedId);
  });

  it("more than one grade per submission", async () => {
    const { insertedId, results } = await runWithViolation(async (tx) => {
      await dropUniqueIndexes(tx, "Grade", "submissionId");
      const duplicate = await tx.grade.create({
        data: {
          assessmentId: fx.assessmentId,
          enrolmentId: fx.paidEnrolmentId,
          submissionId: fx.submissionId,
          score: 60,
          maxScore: 100,
        },
      });
      return duplicate.id;
    });
    expectOnlyViolation(results, "one-grade-per-submission", insertedId);
  });

  it("active certificate without a completion record", async () => {
    const { insertedId, results } = await runWithViolation(async (tx) => {
      const certificate = await tx.certificate.create({
        data: {
          verificationRef: uniq("CERT-V6"),
          enrolmentId: fx.paidEnrolmentId,
          userId: fx.paidUserId,
          scope: "COURSE",
          courseId: fx.courseId,
          awardTitle: "Integrity Course",
          learnerName: "Fixture Learner",
          status: "ACTIVE",
        },
      });
      return certificate.id;
    });
    expectOnlyViolation(results, "active-certificate-has-completion", insertedId);
  });

  it("cohort with more live enrolments than its capacity", async () => {
    const { insertedId, results } = await runWithViolation(async (tx) => {
      const cohort = await tx.cohort.create({
        data: {
          code: uniq("COH-V7"),
          title: "Over capacity",
          courseId: fx.courseId,
          deliveryMode: "INSTRUCTOR_LED",
          startsAt: new Date(Date.now() + 7 * 86_400_000),
          endsAt: new Date(Date.now() + 30 * 86_400_000),
          enrolmentOpensAt: new Date(Date.now() - 86_400_000),
          enrolmentClosesAt: new Date(Date.now() + 5 * 86_400_000),
          capacity: 1,
          priceMinor: 0,
        },
      });
      for (const status of ["ACTIVE", "COMPLETED"] as const) {
        const learner = await tx.user.create({
          data: { email: `${uniq("v7")}@fixture.test`, name: "V7", status: "ACTIVE" },
        });
        await tx.enrolment.create({ data: { cohortId: cohort.id, userId: learner.id, status } });
      }
      return cohort.id;
    });
    expectOnlyViolation(results, "cohort-within-capacity", insertedId);
  });

  it("caps the sample at 20 sorted ids while counting every violation", async () => {
    const { results } = await runWithViolation(async (tx) => {
      const learner = await tx.user.create({
        data: { email: `${uniq("v-many")}@fixture.test`, name: "Many", status: "ACTIVE" },
      });
      for (let i = 0; i < 25; i += 1) await createOrder(tx, learner.id, "REFUNDED");
      return "";
    });
    const check = byId(results).get("paid-order-has-successful-payment")!;
    expect(check.status).toBe("violations");
    expect(check.violationCount).toBe(25);
    expect(check.sampleIds).toHaveLength(INTEGRITY_SAMPLE_LIMIT);
    expect([...check.sampleIds].sort()).toEqual(check.sampleIds);
  });

  it(
    "reports a broken check as error while the other checks still run",
    async () => {
      const logged: string[] = [];
      const broken = INTEGRITY_CHECKS.map((check, index) =>
        index === 2 ? { ...check, sql: `SELECT id::text AS id FROM "TableThatDoesNotExist"` } : check,
      );
      const results = await createIntegrityCheckService({
        client: db.prisma,
        checks: broken,
        log: (message) => logged.push(message),
      }).runIntegrityChecks();

      expect(results).toHaveLength(INTEGRITY_CHECKS.length);
      expect(results[2]).toMatchObject({ id: INTEGRITY_CHECKS[2].id, status: "error", violationCount: 0, sampleIds: [] });
      for (const [index, result] of results.entries()) {
        if (index === 2) continue;
        expect(result.status).toBe("passed");
      }
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain(INTEGRITY_CHECKS[2].id);
    },
    TEST_DB_TIMEOUT_MS,
  );
});
