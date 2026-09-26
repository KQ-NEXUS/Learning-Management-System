/**
 * Real-Postgres proof (plan 12-06) that the contextual "Get help" hint is never
 * authority: ownership is re-resolved against real rows, foreign ids are
 * rejected, and the dashboard's ticket summary is owner-scoped, bounded and
 * excludes closed tickets. Requires Docker (testcontainers); never touches the
 * dev database. Services are imported after DATABASE_URL is set.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";

let testDb: TestDatabase;
let ctx: typeof import("@/server/services/ticket-learner-context-service");
let dash: typeof import("@/server/services/enrolment-dashboard-service");

type Owned = { userId: string; cohortId: string; courseId: string; orderId: string; submissionId: string; certificateId: string };
let a: Owned;
let b: Owned;
let n = 0;

async function seedOwned(): Promise<Owned> {
  const { cohortId, courseId } = await seedCohortFixture(testDb.prisma);
  const { userId, enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });
  n += 1;
  const order = await testDb.prisma.order.create({
    data: { reference: `CTX-${n}-${Date.now()}`, userId, cohortId, amountMinor: 1000, currency: "NGN", status: "PAID", idempotencyKey: `ctx-order-${n}-${Date.now()}` },
  });
  const assessment = await testDb.prisma.assessment.create({
    data: { courseId, type: "ASSIGNMENT", title: "Ctx Assignment", status: "PUBLISHED", version: 1, totalMarks: 10, allowedFileTypes: ["pdf"] },
  });
  const submission = await testDb.prisma.submission.create({
    data: { assessmentId: assessment.id, enrolmentId, attemptNumber: 1, versionUsed: 1, storageKey: `ctx/${n}-${Date.now()}`, filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 5, uploadStatus: "READY" },
  });
  const certificate = await testDb.prisma.certificate.create({
    data: { enrolmentId, userId, scope: "COURSE", courseId, awardTitle: "Ctx", learnerName: "Ctx Learner", issuedAt: new Date(), status: "ACTIVE", verificationRef: `ctx-ref-${n}-${Date.now()}`, storageKey: null },
  });
  return { userId, cohortId, courseId, orderId: order.id, submissionId: submission.id, certificateId: certificate.id };
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  process.env.DATABASE_URL = testDb.url;
  ctx = await import("@/server/services/ticket-learner-context-service");
  dash = await import("@/server/services/enrolment-dashboard-service");
  a = await seedOwned();
  b = await seedOwned();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

describe("learner context hint validation (real PostgreSQL)", () => {
  it("accepts every owned record kind with exactly one relation field", async () => {
    const cases = [
      ["COURSE", a.courseId, "courseId"],
      ["COHORT", a.cohortId, "cohortId"],
      ["ORDER", a.orderId, "orderId"],
      ["SUBMISSION", a.submissionId, "submissionId"],
      ["CERTIFICATE", a.certificateId, "certificateId"],
    ] as const;
    for (const [kind, id, field] of cases) {
      const v = await ctx.validateLearnerTicketContext(a.userId, ctx.parseLearnerContextHint(kind, id));
      expect(v, kind).not.toBeNull();
      expect(Object.keys(v!.input)).toEqual([field]);
    }
  });

  it("rejects another learner's records for every kind", async () => {
    const cases = [
      ["COURSE", b.courseId], ["COHORT", b.cohortId], ["ORDER", b.orderId],
      ["SUBMISSION", b.submissionId], ["CERTIFICATE", b.certificateId],
    ] as const;
    for (const [kind, id] of cases) {
      expect(await ctx.validateLearnerTicketContext(a.userId, ctx.parseLearnerContextHint(kind, id)), kind).toBeNull();
    }
  });

  it("rejects mismatched type/id pairs, unknown ids and malformed hints", async () => {
    expect(await ctx.validateLearnerTicketContext(a.userId, ctx.parseLearnerContextHint("ORDER", a.cohortId))).toBeNull();
    expect(await ctx.validateLearnerTicketContext(a.userId, ctx.parseLearnerContextHint("CERTIFICATE", "nope"))).toBeNull();
    expect(ctx.parseLearnerContextHint("USER", a.userId)).toBeNull();
    expect(ctx.parseLearnerContextHint("ORDER", "")).toBeNull();
    expect(ctx.parseLearnerContextHint(undefined, undefined)).toBeNull();
  });
});

describe("dashboard ticket summary (real PostgreSQL)", () => {
  it("is owner-scoped, excludes closed, bounded to three, newest first, with no private fields", async () => {
    const t = async (userId: string, reference: string, status: "OPEN" | "CLOSED", updatedAt: Date) =>
      testDb.prisma.ticket.create({
        data: { reference, userId, subject: `S ${reference}`, category: "OTHER", status, queue: "GENERAL_SUPPORT", priority: "URGENT", updatedAt } as never,
      });
    await t(a.userId, "TKT-CTX-1", "OPEN", new Date("2026-06-01T00:00:00Z"));
    await t(a.userId, "TKT-CTX-2", "OPEN", new Date("2026-06-05T00:00:00Z"));
    await t(a.userId, "TKT-CTX-3", "CLOSED", new Date("2026-06-09T00:00:00Z"));
    await t(a.userId, "TKT-CTX-4", "OPEN", new Date("2026-06-03T00:00:00Z"));
    await t(a.userId, "TKT-CTX-5", "OPEN", new Date("2026-06-02T00:00:00Z"));
    await t(b.userId, "TKT-CTX-B", "OPEN", new Date("2026-06-10T00:00:00Z"));

    const result = await dash.loadLearnerDashboard({ userId: a.userId, roles: [] } as never);
    expect(result.supportTickets.map((x) => x.reference)).toEqual(["TKT-CTX-2", "TKT-CTX-4", "TKT-CTX-5"]);
    expect(Object.keys(result.supportTickets[0]).sort()).toEqual(["id", "reference", "status", "subject", "updatedAt"]);
  }, TEST_DB_TIMEOUT_MS);
});
