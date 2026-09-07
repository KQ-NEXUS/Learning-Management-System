import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture, seedLearnerFixture } from "./support/cohort-fixtures";
import { createTestWithPermission, grant } from "./support/harness";
import {
  createCohortService, type CohortRecord, type CohortAggregateDelegate,
  type CohortPublishTx, type CohortInstructorDelegate,
} from "@/server/services/cohort-service";
import { createPrismaBackedEnrolmentService } from "@/server/services/enrolment-service";
import { createCohortScopeResolvers } from "@/server/services/cohort-scope";
import { CohortClosedError } from "@/server/services/seat-accounting";
import { StaleOrderError } from "@/server/services/reorder-service";
import type { Delegate, ResourceAuditEntry } from "@/server/services/resource-service";

let db: TestDatabase;
let actorId: string;
type Client = TestDatabase["prisma"];

beforeAll(async () => {
  db = await startTestDatabase();
  actorId = (await seedLearnerFixture(db.prisma)).userId;
}, TEST_DB_TIMEOUT_MS);
afterAll(async () => { await db?.stop(); }, TEST_DB_TIMEOUT_MS);

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function services(client = db.prisma) {
  const audits: ResourceAuditEntry[] = [];
  const audit = async (entry: ResourceAuditEntry) => { audits.push(entry); };
  const { withPermission } = createTestWithPermission([
    grant("cohorts.manage"), grant("cohorts.publish"), grant("enrolments.manage"),
  ], { userId: actorId });
  const scopes = createCohortScopeResolvers({
    cohort: client.cohort, session: client.scheduledSession, enrolment: client.enrolment,
  });
  const cohort = createCohortService({
    delegate: client.cohort as unknown as Delegate<CohortRecord>,
    enrolment: client.enrolment,
    aggregate: client.cohort as unknown as CohortAggregateDelegate,
    instructor: client.cohortInstructor as unknown as CohortInstructorDelegate,
    user: client.user,
    db: { $transaction: (fn) => client.$transaction((tx) => fn(tx as unknown as CohortPublishTx)) },
    toScope: scopes.cohortResourceScope, withPermission, audit,
    runInTransaction: (fn) => client.$transaction(fn),
  });
  return {
    cohort, enrolment: createPrismaBackedEnrolmentService(client, withPermission, audit), audits,
  };
}

/** Pause after the request's outside-transaction reads, without replacing DB behavior. */
function pauseBeforeTransaction() {
  const entered = signal();
  const resume = signal();
  const client = new Proxy(db.prisma, {
    get(target, key) {
      if (key !== "$transaction") return Reflect.get(target, key);
      return async (fn: Parameters<Client["$transaction"]>[0]) => {
        entered.resolve();
        await resume.promise;
        return target.$transaction(fn);
      };
    },
  });
  return { client, entered, resume };
}

async function cancel(cohortId: string) {
  const row = await db.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
  await services().cohort.cancelCohort({
    cohortId, expectedUpdatedAt: row.updatedAt, reason: "Cohort no longer running",
  });
}

describe("cohort lifecycle concurrency against PostgreSQL", () => {
  it.each([
    { target: "ACTIVE" as const, holdMinutes: 30 },
    { target: "PENDING_PAYMENT" as const, holdMinutes: 30 },
    { target: "PENDING_PAYMENT" as const, holdMinutes: null },
  ])("refuses a stale add request after cancellation: %j", async ({ target, holdMinutes }) => {
    const { cohortId } = await seedCohortFixture(db.prisma, { holdMinutes });
    const { userId } = await seedLearnerFixture(db.prisma);
    const gate = pauseBeforeTransaction();
    const service = services(gate.client);
    const outcome = service.enrolment.addEnrolment({
      cohortId, userId, target, reason: "manual enrolment",
    }).then(() => null, (error: unknown) => error);
    try {
      await gate.entered.promise;
      await cancel(cohortId);
    } finally { gate.resume.resolve(); }
    expect(await outcome).toBeInstanceOf(CohortClosedError);
    expect(await db.prisma.enrolment.count({ where: { cohortId } })).toBe(0);
    expect(service.audits).toHaveLength(0);
  });

  it.each([false, true])("refuses stale approval after cancellation (held seat: %s)", async (held) => {
    const { cohortId } = await seedCohortFixture(db.prisma, { seatsTaken: held ? 1 : 0 });
    const { enrolmentId } = await seedEnrolmentFixture(db.prisma, {
      cohortId, status: "PENDING_PAYMENT",
      holdExpiresAt: held ? new Date(Date.now() + 60_000) : null,
    });
    const entered = signal();
    const resume = signal();
    const client = new Proxy(db.prisma, {
      get(target, key) {
        if (key !== "$transaction") return Reflect.get(target, key);
        return (fn: (tx: unknown) => Promise<unknown>) => target.$transaction(async (tx) => fn(new Proxy(tx, {
          get(t, k) {
            if (k !== "enrolment") return Reflect.get(t, k);
            return new Proxy(t.enrolment, {
              get(delegate, method) {
                if (method !== "findUnique") return Reflect.get(delegate, method);
                return async (args: Parameters<typeof delegate.findUnique>[0]) => {
                  const row = await delegate.findUnique(args);
                  entered.resolve();
                  await resume.promise;
                  return row;
                };
              },
            });
          },
        })));
      },
    });
    const service = services(client);
    const outcome = service.enrolment.approveEnrolment({
      enrolmentId, reason: "payment confirmed",
    }).then(() => null, (error: unknown) => error);
    try {
      await entered.promise;
      await cancel(cohortId);
    } finally { resume.resolve(); }
    expect(await outcome).toBeInstanceOf(CohortClosedError);
    expect((await db.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } })).status).toBe("CANCELLED");
    expect((await db.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })).seatsTaken).toBe(0);
    expect(service.audits).toHaveLength(0);
  });

  it("rolls back a stale transfer when its destination has been cancelled", async () => {
    const source = await seedCohortFixture(db.prisma, { seatsTaken: 1 });
    const target = await seedCohortFixture(db.prisma, { courseId: source.courseId });
    const { enrolmentId } = await seedEnrolmentFixture(db.prisma, { cohortId: source.cohortId, status: "ACTIVE" });
    const gate = pauseBeforeTransaction();
    const service = services(gate.client);
    const outcome = service.enrolment.transferEnrolment({
      enrolmentId, targetCohortId: target.cohortId, reason: "cohort transfer",
    }).then(() => null, (error: unknown) => error);
    try {
      await gate.entered.promise;
      await cancel(target.cohortId);
    } finally { gate.resume.resolve(); }
    expect(await outcome).toBeInstanceOf(CohortClosedError);
    expect((await db.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } })).status).toBe("ACTIVE");
    expect((await db.prisma.cohort.findUniqueOrThrow({ where: { id: source.cohortId } })).seatsTaken).toBe(1);
    expect(await db.prisma.enrolment.count({ where: { cohortId: target.cohortId } })).toBe(0);
    expect(service.audits).toHaveLength(0);
  });

  it("holds the cohort row lock before reading even an empty cancellation roster", async () => {
    const { cohortId } = await seedCohortFixture(db.prisma, { holdMinutes: null });
    const before = await db.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    const entered = signal();
    const resume = signal();
    const client = new Proxy(db.prisma, {
      get(target, key) {
        if (key !== "$transaction") return Reflect.get(target, key);
        return (fn: (tx: unknown) => Promise<unknown>) => target.$transaction(async (tx) => fn(new Proxy(tx, {
          get(t, k) {
            if (k !== "enrolment") return Reflect.get(t, k);
            return new Proxy(t.enrolment, {
              get(delegate, method) {
                if (method !== "findMany") return Reflect.get(delegate, method);
                return async (args: Parameters<typeof delegate.findMany>[0]) => {
                  entered.resolve();
                  await resume.promise;
                  return delegate.findMany(args);
                };
              },
            });
          },
        })));
      },
    });
    const outcome = services(client).cohort.cancelCohort({
      cohortId, expectedUpdatedAt: before.updatedAt, reason: "Cohort no longer running",
    });
    try {
      await entered.promise;
      // NOWAIT proves lock ownership without arbitrary sleeps or query-text mocks.
      await expect(db.prisma.$queryRaw`
        SELECT "id" FROM "Cohort" WHERE "id" = ${cohortId} FOR UPDATE NOWAIT
      `).rejects.toMatchObject({ code: "P2010", meta: { code: "55P03" } });
    } finally { resume.resolve(); }
    await outcome;
    expect((await db.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })).status).toBe("CANCELLED");
  });

  it.each(["CANCELLED", "COMPLETED"] as const)("cannot overwrite %s after a stale readiness read, even with an unchanged version", async (status) => {
    const { cohortId, courseId } = await seedCohortFixture(db.prisma, { deliveryMode: "SELF_PACED" });
    await db.prisma.course.update({ where: { id: courseId }, data: { status: "PUBLISHED" } });
    await db.prisma.coursePublication.create({
      data: { courseId, version: 1, publishedById: actorId, payload: { completionRule: { kind: "ALL_REQUIRED" } } },
    });
    const before = await db.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    const gate = pauseBeforeTransaction();
    const service = services(gate.client);
    const outcome = service.cohort.publishCohort({
      cohortId, expectedUpdatedAt: before.updatedAt,
    }).then(() => null, (error: unknown) => error);
    try {
      await gate.entered.promise;
      await db.prisma.$executeRaw`
        UPDATE "Cohort" SET "status" = ${status}::"CohortStatus" WHERE "id" = ${cohortId}
      `;
    } finally { gate.resume.resolve(); }
    expect(await outcome).toBeInstanceOf(StaleOrderError);
    const after = await db.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    expect(after.status).toBe(status);
    expect(after.coursePublicationId).toBeNull();
    expect(service.audits).toHaveLength(0);
  });
});
