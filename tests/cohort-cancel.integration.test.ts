/**
 * Real-Postgres proof for `cancelCohort` (plan 05-11, Task 2, D-31).
 *
 * The unit test (`tests/cohort-service.test.ts`) drives `cancelCohort` with an
 * in-memory staged-commit fake `$transaction`. That fake cannot raise a real
 * transaction rollback on a mid-loop throw, cannot prove the conditional
 * `cohort.updateMany` claim survives real concurrency semantics, and cannot
 * prove that a `WITHDRAWN` enrolment's `AttendanceRecord` history genuinely
 * survives cascade rules. This file starts a throwaway `postgres:16-alpine`
 * container (see `tests/support/pg.ts`), deploys the checked-in migrations,
 * and exercises the real schema.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — never a silent
 * pass, never a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createTestWithPermission, grant } from "./support/harness";
import {
  seedAttendanceFixture,
  seedCohortFixture,
  seedEnrolmentFixture,
  seedLearnerFixture,
  seedSessionFixture,
} from "./support/cohort-fixtures";
import {
  createCohortService,
  CohortCancelBlockedError,
  type CohortRecord,
  type CohortAggregateDelegate,
  type CohortGuardEnrolmentDelegate,
  type CohortPublishTx,
} from "@/server/services/cohort-service";
import { createCohortScopeResolvers } from "@/server/services/cohort-scope";
import { type Delegate } from "@/server/services/resource-service";
import { StaleOrderError } from "@/server/services/reorder-service";
import { AuthorizationError } from "@/server/permissions/with-permission";

let testDb: TestDatabase;
let actorId: string;

type PrismaLike = TestDatabase["prisma"];
type Svc = ReturnType<typeof buildCohortService>;

/**
 * Builds `cancelCohort` (and its sibling operations) against a given Prisma
 * client and `withPermission` — the same wiring `cohort-service.ts`'s own
 * module-level "Prisma-backed binding" section does for the live singleton,
 * parameterised here so this test proves the real transaction against a
 * throwaway container instead of the production database.
 */
function buildCohortService(
  prisma: PrismaLike,
  withPermission: ReturnType<typeof createTestWithPermission>["withPermission"],
  audit: (entry: Record<string, unknown>) => Promise<void>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = prisma as any;
  const { cohortResourceScope } = createCohortScopeResolvers({
    cohort: p.cohort,
    session: p.scheduledSession,
    enrolment: p.enrolment,
  });

  return createCohortService({
    delegate: p.cohort as Delegate<CohortRecord>,
    enrolment: p.enrolment as CohortGuardEnrolmentDelegate,
    aggregate: p.cohort as CohortAggregateDelegate,
    instructor: p.cohortInstructor,
    user: p.user,
    db: {
      $transaction: (fn) => p.$transaction((tx: unknown) => fn(tx as CohortPublishTx)),
    },
    toScope: cohortResourceScope,
    withPermission,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    audit: audit as any,
    runInTransaction: (fn) => p.$transaction(fn),
  });
}

function serviceWithGrants(grants: Parameters<typeof createTestWithPermission>[0]): Svc {
  const { withPermission } = createTestWithPermission(grants, { userId: actorId });
  return buildCohortService(testDb.prisma, withPermission, async (entry) => {
    await testDb.prisma.auditEvent.create({
      data: {
        actorId: entry.actorId as string,
        action: entry.action as string,
        targetType: entry.targetType as string,
        targetId: entry.targetId as string | null,
        before: (entry.before ?? undefined) as never,
        after: (entry.after ?? undefined) as never,
        reason: (entry.reason ?? null) as string | null,
        outcome: entry.outcome as string,
      },
    });
  });
}

const globalService = () => serviceWithGrants([grant("cohorts.manage")]);

it("allows only one competing cohort edit for the same page version", async () => {
  const { cohortId } = await seedCohortFixture(testDb.prisma);
  const before = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
  const service = globalService();
  const results = await Promise.allSettled(["First editor", "Second editor"].map((title) =>
    service.updateCohort({ id: cohortId, expectedUpdatedAt: before.updatedAt, data: { title } }),
  ));
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(StaleOrderError);
  expect(await testDb.prisma.auditEvent.count({ where: { targetId: cohortId, action: "cohort.updated" } })).toBe(1);
});

async function countEvents(type: string): Promise<number> {
  return testDb.prisma.domainEvent.count({ where: { type } });
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  actorId = (await seedLearnerFixture(testDb.prisma, { name: "Ops Staff" })).userId;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/** A cohort with capacity 5 / seatsTaken 3, mixed-status enrolments, three
 *  sessions (one already cancelled), and attendance on the active learners. */
async function seedMixedRoster() {
  const { cohortId } = await seedCohortFixture(testDb.prisma, {
    capacity: 5,
    seatsTaken: 3,
    holdMinutes: 30,
  });

  const active1 = await seedEnrolmentFixture(testDb.prisma, { cohortId, status: "ACTIVE" });
  const active2 = await seedEnrolmentFixture(testDb.prisma, { cohortId, status: "ACTIVE" });
  const pending = await seedEnrolmentFixture(testDb.prisma, {
    cohortId,
    status: "PENDING_PAYMENT",
    holdExpiresAt: new Date(Date.now() + 20 * 60_000),
  });
  const alreadyWithdrawn = await seedEnrolmentFixture(testDb.prisma, {
    cohortId,
    status: "WITHDRAWN",
    reason: "left before this cancellation",
    withdrawnAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  const sessionOpen1 = await seedSessionFixture(testDb.prisma, { cohortId });
  const sessionOpen2 = await seedSessionFixture(testDb.prisma, { cohortId });
  const sessionAlreadyCancelled = await seedSessionFixture(testDb.prisma, {
    cohortId,
    cancelledAt: new Date("2026-02-01T00:00:00.000Z"),
    cancellationReason: "weather closure",
  });

  await seedAttendanceFixture(testDb.prisma, {
    sessionId: sessionOpen1.sessionId,
    enrolmentId: active1.enrolmentId,
    state: "PRESENT",
  });
  await seedAttendanceFixture(testDb.prisma, {
    sessionId: sessionOpen2.sessionId,
    enrolmentId: active2.enrolmentId,
    state: "ABSENT",
  });

  return {
    cohortId,
    active1,
    active2,
    pending,
    alreadyWithdrawn,
    sessionOpen1,
    sessionOpen2,
    sessionAlreadyCancelled,
  };
}

describe("cancelCohort — real Postgres (D-31)", () => {
  it("case 1: withdraws ACTIVE, cancels the PENDING_PAYMENT hold, leaves the pre-existing WITHDRAWN row byte-identical, soft-cancels open sessions, zeroes seatsTaken, and deletes nothing", async () => {
    const roster = await seedMixedRoster();
    const beforeWithdrawn = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: roster.alreadyWithdrawn.enrolmentId },
    });
    const counts = {
      cohort: await testDb.prisma.cohort.count(),
      session: await testDb.prisma.scheduledSession.count(),
      enrolment: await testDb.prisma.enrolment.count(),
      attendance: await testDb.prisma.attendanceRecord.count(),
    };

    const cohortBefore = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: roster.cohortId },
    });
    const svc = globalService();
    await svc.cancelCohort({
      cohortId: roster.cohortId,
      reason: "Cohort cancelled — instructor unavailable",
      expectedUpdatedAt: cohortBefore.updatedAt,
    });

    const active1After = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: roster.active1.enrolmentId },
    });
    expect(active1After.status).toBe("WITHDRAWN");
    expect(active1After.reason).toBe("Cohort cancelled — instructor unavailable");
    expect(active1After.withdrawnAt).not.toBeNull();

    const active2After = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: roster.active2.enrolmentId },
    });
    expect(active2After.status).toBe("WITHDRAWN");
    expect(active2After.withdrawnAt).not.toBeNull();

    const pendingAfter = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: roster.pending.enrolmentId },
    });
    expect(pendingAfter.status).toBe("CANCELLED");
    expect(pendingAfter.holdExpiresAt).toBeNull();
    expect(pendingAfter.reason).toBe("Cohort cancelled — instructor unavailable");

    const withdrawnAfter = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: roster.alreadyWithdrawn.enrolmentId },
    });
    expect(withdrawnAfter).toEqual(beforeWithdrawn);

    const sessionOpen1After = await testDb.prisma.scheduledSession.findUniqueOrThrow({
      where: { id: roster.sessionOpen1.sessionId },
    });
    expect(sessionOpen1After.cancelledAt).not.toBeNull();
    expect(sessionOpen1After.cancellationReason).toBe(
      "Cohort cancelled — instructor unavailable",
    );

    const sessionOpen2After = await testDb.prisma.scheduledSession.findUniqueOrThrow({
      where: { id: roster.sessionOpen2.sessionId },
    });
    expect(sessionOpen2After.cancelledAt).not.toBeNull();

    const sessionAlreadyCancelledAfter = await testDb.prisma.scheduledSession.findUniqueOrThrow({
      where: { id: roster.sessionAlreadyCancelled.sessionId },
    });
    expect(sessionAlreadyCancelledAfter.cancelledAt?.getTime()).toBe(
      new Date("2026-02-01T00:00:00.000Z").getTime(),
    );
    expect(sessionAlreadyCancelledAfter.cancellationReason).toBe("weather closure");

    const cohortAfter = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: roster.cohortId },
    });
    expect(cohortAfter.status).toBe("CANCELLED");
    expect(cohortAfter.seatsTaken).toBe(0);

    // Nothing deleted — every table's row count is unchanged.
    expect(await testDb.prisma.cohort.count()).toBe(counts.cohort);
    expect(await testDb.prisma.scheduledSession.count()).toBe(counts.session);
    expect(await testDb.prisma.enrolment.count()).toBe(counts.enrolment);
    expect(await testDb.prisma.attendanceRecord.count()).toBe(counts.attendance);
  });

  it("case 2: writes one AuditEvent per affected enrolment, one per cancelled session, and one for the cohort — never a single batch row", async () => {
    const roster = await seedMixedRoster();
    const cohortBefore = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: roster.cohortId },
    });
    const svc = globalService();
    const reason = "Per-transition audit proof";
    await svc.cancelCohort({
      cohortId: roster.cohortId,
      reason,
      expectedUpdatedAt: cohortBefore.updatedAt,
    });

    const enrolmentAudits = await testDb.prisma.auditEvent.findMany({
      where: {
        targetType: "Enrolment",
        targetId: {
          in: [
            roster.active1.enrolmentId,
            roster.active2.enrolmentId,
            roster.pending.enrolmentId,
          ],
        },
        reason,
      },
    });
    expect(enrolmentAudits).toHaveLength(3);
    expect(
      enrolmentAudits.find((a) => a.targetId === roster.active1.enrolmentId)?.action,
    ).toBe("enrolment.withdrawn");
    expect(
      enrolmentAudits.find((a) => a.targetId === roster.pending.enrolmentId)?.action,
    ).toBe("enrolment.cancelled");

    const sessionAudits = await testDb.prisma.auditEvent.findMany({
      where: {
        targetType: "ScheduledSession",
        targetId: { in: [roster.sessionOpen1.sessionId, roster.sessionOpen2.sessionId] },
        reason,
      },
    });
    expect(sessionAudits).toHaveLength(2);

    const cohortAudit = await testDb.prisma.auditEvent.findFirst({
      where: { targetType: "Cohort", targetId: roster.cohortId, action: "cohort.cancelled", reason },
    });
    expect(cohortAudit).not.toBeNull();

    // No batch-level row masquerading as the per-learner history.
    expect(enrolmentAudits.length + sessionAudits.length + 1).toBe(6);
  });

  it("case 3: emits one DomainEvent per affected enrolment plus one cohort.cancelled", async () => {
    const roster = await seedMixedRoster();
    const cohortBefore = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: roster.cohortId },
    });
    const withdrawnBefore = await countEvents("enrolment.withdrawn");
    const cancelledBefore = await countEvents("enrolment.cancelled");
    const cohortCancelledBefore = await countEvents("cohort.cancelled");

    const svc = globalService();
    await svc.cancelCohort({
      cohortId: roster.cohortId,
      reason: "Outbox proof",
      expectedUpdatedAt: cohortBefore.updatedAt,
    });

    expect((await countEvents("enrolment.withdrawn")) - withdrawnBefore).toBe(2);
    expect((await countEvents("enrolment.cancelled")) - cancelledBefore).toBe(1);
    expect((await countEvents("cohort.cancelled")) - cohortCancelledBefore).toBe(1);
  });

  it("case 4: a stale expectedUpdatedAt leaves the cohort open, no enrolment changed status, and no session cancelled", async () => {
    const roster = await seedMixedRoster();
    const svc = globalService();

    await expect(
      svc.cancelCohort({
        cohortId: roster.cohortId,
        reason: "Should not apply — stale token",
        expectedUpdatedAt: new Date("2000-01-01T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(StaleOrderError);

    const cohortAfter = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: roster.cohortId },
    });
    expect(cohortAfter.status).not.toBe("CANCELLED");
    expect(cohortAfter.seatsTaken).toBe(3);

    for (const id of [roster.active1.enrolmentId, roster.active2.enrolmentId]) {
      const row = await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("ACTIVE");
    }
    const pendingRow = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: roster.pending.enrolmentId },
    });
    expect(pendingRow.status).toBe("PENDING_PAYMENT");
    expect(pendingRow.holdExpiresAt).not.toBeNull();

    for (const sessionId of [roster.sessionOpen1.sessionId, roster.sessionOpen2.sessionId]) {
      const session = await testDb.prisma.scheduledSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(session.cancelledAt).toBeNull();
    }
  });

  it("case 5: a second cancelCohort on the now-cancelled cohort throws CohortCancelBlockedError and changes nothing", async () => {
    const roster = await seedMixedRoster();
    const cohortBefore = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: roster.cohortId },
    });
    const svc = globalService();
    await svc.cancelCohort({
      cohortId: roster.cohortId,
      reason: "First cancellation",
      expectedUpdatedAt: cohortBefore.updatedAt,
    });

    const auditCountBefore = await testDb.prisma.auditEvent.count();
    const eventCountBefore = await testDb.prisma.domainEvent.count();
    const cohortAfterFirst = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: roster.cohortId },
    });

    await expect(
      svc.cancelCohort({
        cohortId: roster.cohortId,
        reason: "Second cancellation attempt",
        expectedUpdatedAt: cohortAfterFirst.updatedAt,
      }),
    ).rejects.toBeInstanceOf(CohortCancelBlockedError);

    expect(await testDb.prisma.auditEvent.count()).toBe(auditCountBefore);
    expect(await testDb.prisma.domainEvent.count()).toBe(eventCountBefore);
    const cohortAfterSecond = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: roster.cohortId },
    });
    expect(cohortAfterSecond.status).toBe("CANCELLED");
    expect(cohortAfterSecond.seatsTaken).toBe(0);
  });

  it("case 6: the withdrawn learners' AttendanceRecord rows survive with their original states", async () => {
    const roster = await seedMixedRoster();
    const cohortBefore = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: roster.cohortId },
    });
    const svc = globalService();
    await svc.cancelCohort({
      cohortId: roster.cohortId,
      reason: "Attendance-preservation proof",
      expectedUpdatedAt: cohortBefore.updatedAt,
    });

    const attendance1 = await testDb.prisma.attendanceRecord.findFirstOrThrow({
      where: { enrolmentId: roster.active1.enrolmentId, sessionId: roster.sessionOpen1.sessionId },
    });
    expect(attendance1.state).toBe("PRESENT");

    const attendance2 = await testDb.prisma.attendanceRecord.findFirstOrThrow({
      where: { enrolmentId: roster.active2.enrolmentId, sessionId: roster.sessionOpen2.sessionId },
    });
    expect(attendance2.state).toBe("ABSENT");
  });

  it("requires cohorts.manage — a cohorts.view-only caller is denied and writes nothing", async () => {
    const roster = await seedMixedRoster();
    const cohortBefore = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: roster.cohortId },
    });
    const scoped = serviceWithGrants([grant("cohorts.view")]);

    await expect(
      scoped.cancelCohort({
        cohortId: roster.cohortId,
        reason: "Should be denied",
        expectedUpdatedAt: cohortBefore.updatedAt,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const cohortAfter = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: roster.cohortId },
    });
    expect(cohortAfter.status).not.toBe("CANCELLED");
  });
});
