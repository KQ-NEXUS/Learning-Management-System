/**
 * Real-Postgres proof of adding several learners to a cohort in one go
 * (owner decisions, 2026-10-05): one status and one reason for all of them, and
 * all are added or none.
 *
 * Only a real database can show the "or none": that a refusal part-way through
 * leaves no enrolment, no seat count change and no event behind, and that the
 * seat count stays exact when two batches race for the last seats.
 *
 * PREREQUISITE: Docker must be running (tests/support/pg.ts starts the
 * container). If it is not, `beforeAll` fails and every case reports BLOCKED.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createTestWithPermission, grant } from "./support/harness";
import { seedCohortFixture, seedEnrolmentFixture, seedLearnerFixture } from "./support/cohort-fixtures";
import {
  createPrismaBackedEnrolmentService,
  EnrolmentBatchAlreadyEnrolledError,
  EnrolmentBatchCapacityError,
} from "@/server/services/enrolment-service";
import { AuthorizationError } from "@/server/permissions/with-permission";
import { CohortClosedError } from "@/server/services/seat-accounting";

const REASON = "Corporate group booking for a partner organisation";
let testDb: TestDatabase;
let actorId: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  actorId = (await seedLearnerFixture(testDb.prisma, { isStaff: true })).userId;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

function service(grants = [grant("enrolments.manage")]) {
  const { withPermission } = createTestWithPermission(grants, { userId: actorId });
  return createPrismaBackedEnrolmentService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    testDb.prisma as any,
    withPermission,
    async (entry) => {
      await testDb.prisma.auditEvent.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          before: (entry.before ?? undefined) as never,
          after: (entry.after ?? undefined) as never,
          reason: entry.reason ?? null,
          outcome: entry.outcome,
        },
      });
    },
  );
}

const learners = async (count: number) =>
  Promise.all(Array.from({ length: count }, async () => (await seedLearnerFixture(testDb.prisma)).userId));
const seatsTaken = async (cohortId: string) => (await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })).seatsTaken;
const enrolmentsIn = (cohortId: string) => testDb.prisma.enrolment.findMany({ where: { cohortId }, orderBy: { createdAt: "asc" } });
const eventsFor = async (cohortId: string) =>
  (await testDb.prisma.domainEvent.findMany({ where: { type: "enrolment.created" } })).filter(
    (event) => (event.payload as { cohortId?: string }).cohortId === cohortId,
  );

describe("adding several learners at once", () => {
  it("adds every learner as their own active enrolment, and takes exactly that many seats", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 10, seatsTaken: 2 });
    const userIds = await learners(4);

    const result = await service().addEnrolments({ cohortId, userIds, target: "ACTIVE", reason: REASON });

    expect(result).toMatchObject({ added: 4, status: "ACTIVE", heldSeat: true });
    const rows = await enrolmentsIn(cohortId);
    expect(rows.map((row) => row.userId).sort()).toEqual([...userIds].sort());
    expect(rows.every((row) => row.status === "ACTIVE" && row.reason === REASON && row.activatedAt !== null)).toBe(true);
    expect(await seatsTaken(cohortId)).toBe(6);
  });

  it("writes one event and one audit entry per learner, each with the reason", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 10, seatsTaken: 0 });
    const userIds = await learners(3);

    const result = await service().addEnrolments({ cohortId, userIds, target: "ACTIVE", reason: REASON });

    expect(await eventsFor(cohortId)).toHaveLength(3);
    const audits = await testDb.prisma.auditEvent.findMany({
      where: { action: "enrolment.created", targetId: { in: result.enrolmentIds } },
    });
    expect(audits).toHaveLength(3);
    expect(audits.every((audit) => audit.reason === REASON && audit.actorId === actorId)).toBe(true);
  });

  it("fills the last seats exactly", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5, seatsTaken: 2 });
    await service().addEnrolments({ cohortId, userIds: await learners(3), target: "ACTIVE", reason: REASON });
    expect(await seatsTaken(cohortId)).toBe(5);
  });

  it("adds NOBODY when there are fewer seats than learners, and says how many seats are left", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5, seatsTaken: 2 });
    const userIds = await learners(5);

    const attempt = service().addEnrolments({ cohortId, userIds, target: "ACTIVE", reason: REASON });

    await expect(attempt).rejects.toBeInstanceOf(EnrolmentBatchCapacityError);
    await expect(attempt).rejects.toThrow(/Only 3 seats are left in this cohort and 5 learners were chosen, so nobody was added/);
    expect(await enrolmentsIn(cohortId)).toHaveLength(0);
    expect(await seatsTaken(cohortId)).toBe(2);
    expect(await eventsFor(cohortId)).toHaveLength(0);
  });

  it("says the cohort is full when no seat is left at all", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 2 });
    await expect(
      service().addEnrolments({ cohortId, userIds: await learners(1), target: "ACTIVE", reason: REASON }),
    ).rejects.toThrow(/This cohort is full, so nobody was added/);
  });

  it("adds NOBODY when one of the learners already has a place, even one chosen last", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 10, seatsTaken: 1 });
    const [already, ...fresh] = await learners(4);
    await seedEnrolmentFixture(testDb.prisma, { cohortId, userId: already, status: "ACTIVE" });

    await expect(
      service().addEnrolments({ cohortId, userIds: [...fresh, already!], target: "ACTIVE", reason: REASON }),
    ).rejects.toBeInstanceOf(EnrolmentBatchAlreadyEnrolledError);

    const rows = await enrolmentsIn(cohortId);
    expect(rows.map((row) => row.userId)).toEqual([already]);
    expect(await seatsTaken(cohortId)).toBe(1);
    expect(await eventsFor(cohortId)).toHaveLength(0);
  });

  it("a learner named twice in one request is added once", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 10, seatsTaken: 0 });
    const [one, two] = await learners(2);

    const result = await service().addEnrolments({ cohortId, userIds: [one!, two!, one!], target: "ACTIVE", reason: REASON });

    expect(result.added).toBe(2);
    expect(await seatsTaken(cohortId)).toBe(2);
  });

  it("pending payment on a cohort with no hold takes no seat, however many are added", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 2, holdMinutes: null });
    const result = await service().addEnrolments({ cohortId, userIds: await learners(4), target: "PENDING_PAYMENT", reason: REASON });

    expect(result).toMatchObject({ added: 4, heldSeat: false });
    expect(await seatsTaken(cohortId)).toBe(2);
    expect((await enrolmentsIn(cohortId)).every((row) => row.status === "PENDING_PAYMENT" && row.holdExpiresAt === null)).toBe(true);
  });

  it("pending payment on a cohort with a hold takes the seats and sets the hold on each", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5, seatsTaken: 0, holdMinutes: 30 });
    await service().addEnrolments({ cohortId, userIds: await learners(3), target: "PENDING_PAYMENT", reason: REASON });

    expect(await seatsTaken(cohortId)).toBe(3);
    expect((await enrolmentsIn(cohortId)).every((row) => row.holdExpiresAt !== null)).toBe(true);
  });

  it("handles a large group in one go", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 200, seatsTaken: 0 });
    const result = await service().addEnrolments({ cohortId, userIds: await learners(150), target: "ACTIVE", reason: REASON });

    expect(result.added).toBe(150);
    expect(await seatsTaken(cohortId)).toBe(150);
    expect(await enrolmentsIn(cohortId)).toHaveLength(150);
  }, 120_000);

  it("two groups racing for the last seats: one is added whole, the other not at all", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5, seatsTaken: 0 });
    const [groupA, groupB] = [await learners(3), await learners(3)];

    const outcomes = await Promise.allSettled([
      service().addEnrolments({ cohortId, userIds: groupA, target: "ACTIVE", reason: REASON }),
      service().addEnrolments({ cohortId, userIds: groupB, target: "ACTIVE", reason: REASON }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(EnrolmentBatchCapacityError);
    expect(refused.reason.message).toMatch(/Only 2 seats are left/);
    expect(await seatsTaken(cohortId)).toBe(3);
    const rows = await enrolmentsIn(cohortId);
    expect(rows).toHaveLength(3);
    const added = new Set(rows.map((row) => row.userId));
    expect(groupA.every((id) => added.has(id)) || groupB.every((id) => added.has(id))).toBe(true);
  }, 60_000);

  it("refuses a cancelled cohort", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5, seatsTaken: 0, status: "CANCELLED" });
    await expect(
      service().addEnrolments({ cohortId, userIds: await learners(2), target: "ACTIVE", reason: REASON }),
    ).rejects.toBeInstanceOf(CohortClosedError);
    expect(await enrolmentsIn(cohortId)).toHaveLength(0);
  });

  it("is refused without enrolments.manage, and adds nobody", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5, seatsTaken: 0 });
    await expect(
      service([grant("enrolments.view")]).addEnrolments({ cohortId, userIds: await learners(2), target: "ACTIVE", reason: REASON }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await enrolmentsIn(cohortId)).toHaveLength(0);
  });

  it("needs a reason and at least one learner", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5, seatsTaken: 0 });
    await expect(service().addEnrolments({ cohortId, userIds: await learners(1), target: "ACTIVE", reason: "   " })).rejects.toThrow();
    await expect(service().addEnrolments({ cohortId, userIds: [], target: "ACTIVE", reason: REASON })).rejects.toThrow(
      "Choose at least one learner.",
    );
    expect(await enrolmentsIn(cohortId)).toHaveLength(0);
  });
});
