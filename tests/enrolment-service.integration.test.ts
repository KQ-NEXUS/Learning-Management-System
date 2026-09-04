/**
 * Real-Postgres proof for the enrolment state machine (plan 05-07, D-12..D-16).
 *
 * The unit test (`tests/enrolment-service.test.ts`) drives the transitions
 * with an in-memory staged-commit fake. That fake cannot raise a real
 * partial-unique-index P2002, cannot prove a transfer is atomic under a real
 * `$transaction`, and cannot prove `seatsTaken` stays coherent against the
 * `cohort_capacity_not_exceeded` / `enrolment_hold_expiry_only_when_pending`
 * CHECKs. This file starts a throwaway `postgres:16-alpine` (see
 * `tests/support/pg.ts`), deploys the checked-in migrations, and exercises the
 * real schema.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error and every case reports BLOCKED — never a silent pass,
 * never a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  TEST_DB_TIMEOUT_MS,
  type TestDatabase,
} from "./support/pg";
import { createTestWithPermission, grant } from "./support/harness";
import {
  seedAttendanceFixture,
  seedCohortFixture,
  seedEnrolmentFixture,
  seedLearnerFixture,
  seedSessionFixture,
} from "./support/cohort-fixtures";
import {
  createPrismaBackedEnrolmentService,
  CrossOfferTransferError,
  IllegalTransitionError,
} from "@/server/services/enrolment-service";
import { AlreadyEnrolledError } from "@/server/services/seat-accounting";

let testDb: TestDatabase;
let actorId: string;

type Svc = ReturnType<typeof createPrismaBackedEnrolmentService>;

function serviceWithGrants(
  grants: Parameters<typeof createTestWithPermission>[0],
): Svc {
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

const globalService = () => serviceWithGrants([grant("enrolments.manage")]);

async function seatsTaken(cohortId: string): Promise<number> {
  const c = await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
  return c.seatsTaken;
}

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

// ---------------------------------------------------------------------------
// 1. D-13 transfer end state
// ---------------------------------------------------------------------------

describe("transferEnrolment — D-13 end state", () => {
  it("moves the enrolment, releases the source seat, links the new row, and carries NO attendance across", async () => {
    const src = await seedCohortFixture(testDb.prisma, { capacity: 5, seatsTaken: 1 });
    const tgt = await seedCohortFixture(testDb.prisma, {
      courseId: src.courseId,
      capacity: 5,
      seatsTaken: 0,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId: src.cohortId,
      userId,
      status: "ACTIVE",
    });
    const { sessionId } = await seedSessionFixture(testDb.prisma, {
      cohortId: src.cohortId,
    });
    await seedAttendanceFixture(testDb.prisma, { sessionId, enrolmentId, state: "PRESENT" });
    await seedAttendanceFixture(testDb.prisma, {
      sessionId: (await seedSessionFixture(testDb.prisma, { cohortId: src.cohortId })).sessionId,
      enrolmentId,
      state: "ABSENT",
    });

    const res = await globalService().transferEnrolment({
      enrolmentId,
      targetCohortId: tgt.cohortId,
      reason: "moved to the later cohort",
    });

    const source = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: enrolmentId },
    });
    expect(source.status).toBe("TRANSFERRED");
    expect(source.reason).toBe("moved to the later cohort");
    expect(source.holdExpiresAt).toBeNull();

    const target = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: res.targetEnrolmentId },
    });
    expect(target.status).toBe("ACTIVE");
    expect(target.cohortId).toBe(tgt.cohortId);
    expect(target.transferredFromId).toBe(enrolmentId);

    expect(await seatsTaken(src.cohortId)).toBe(0);
    expect(await seatsTaken(tgt.cohortId)).toBe(1);

    expect(
      await testDb.prisma.attendanceRecord.count({
        where: { enrolmentId: res.targetEnrolmentId },
      }),
    ).toBe(0);
    expect(
      await testDb.prisma.attendanceRecord.count({ where: { enrolmentId } }),
    ).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 2. D-13 cross-offer refusal
  // -------------------------------------------------------------------------

  it("refuses a target of a different offer and changes nothing", async () => {
    const src = await seedCohortFixture(testDb.prisma, { capacity: 5, seatsTaken: 1 });
    const tgt = await seedCohortFixture(testDb.prisma, { capacity: 5, seatsTaken: 0 });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId: src.cohortId,
      status: "ACTIVE",
    });

    await expect(
      globalService().transferEnrolment({
        enrolmentId,
        targetCohortId: tgt.cohortId,
        reason: "cross offer",
      }),
    ).rejects.toBeInstanceOf(CrossOfferTransferError);

    expect(
      (await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } }))
        .status,
    ).toBe("ACTIVE");
    expect(await seatsTaken(src.cohortId)).toBe(1);
    expect(await seatsTaken(tgt.cohortId)).toBe(0);
    expect(
      await testDb.prisma.enrolment.count({ where: { cohortId: tgt.cohortId } }),
    ).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 3. Transfer atomicity
  // -------------------------------------------------------------------------

  it("a capacity-full target rolls the whole transfer back — source stays ACTIVE, no target row", async () => {
    const src = await seedCohortFixture(testDb.prisma, { capacity: 5, seatsTaken: 1 });
    const tgt = await seedCohortFixture(testDb.prisma, {
      courseId: src.courseId,
      capacity: 1,
      seatsTaken: 1,
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId: src.cohortId,
      status: "ACTIVE",
    });

    await expect(
      globalService().transferEnrolment({
        enrolmentId,
        targetCohortId: tgt.cohortId,
        reason: "target full",
      }),
    ).rejects.toThrow();

    expect(
      (await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } }))
        .status,
    ).toBe("ACTIVE");
    expect(await seatsTaken(src.cohortId)).toBe(1);
    expect(
      await testDb.prisma.enrolment.count({ where: { cohortId: tgt.cohortId } }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. D-15 clean duplicate-active
// ---------------------------------------------------------------------------

describe("addEnrolment — D-15 duplicate active", () => {
  it("rejects with a typed AlreadyEnrolledError, not a raw Prisma error", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 1,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    await seedEnrolmentFixture(testDb.prisma, { cohortId, userId, status: "ACTIVE" });

    const rejection = await globalService()
      .addEnrolment({ cohortId, userId, target: "ACTIVE", reason: "second add" })
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(rejection).toBeInstanceOf(AlreadyEnrolledError);
    expect((rejection as { constructor: { name: string } }).constructor.name).toBe(
      "AlreadyEnrolledError",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Pitfall 3 — seat coherence across add(hold) -> approve -> withdraw
// ---------------------------------------------------------------------------

describe("seat coherence (RESEARCH Pitfall 3)", () => {
  it("seatsTaken never exceeds 1 and ends equal to the held-seat count (0)", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 0,
      holdMinutes: 30,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const svc = globalService();

    const added = await svc.addEnrolment({
      cohortId,
      userId,
      target: "PENDING_PAYMENT",
      reason: "awaiting transfer",
    });
    expect(await seatsTaken(cohortId)).toBe(1);

    await svc.approveEnrolment({ enrolmentId: added.id, reason: "payment confirmed" });
    expect(await seatsTaken(cohortId)).toBe(1);

    await svc.withdrawEnrolment({ enrolmentId: added.id, reason: "changed mind" });
    const finalSeats = await seatsTaken(cohortId);
    expect(finalSeats).toBeLessThanOrEqual(1);

    const heldCount = (
      await testDb.prisma.enrolment.findMany({ where: { cohortId } })
    ).filter(
      (e) =>
        e.status === "ACTIVE" ||
        (e.status === "PENDING_PAYMENT" && e.holdExpiresAt !== null),
    ).length;
    expect(finalSeats).toBe(heldCount);
    expect(finalSeats).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 6. Hold-less approve
  // -------------------------------------------------------------------------

  it("a hold-less PENDING_PAYMENT takes no seat until approve claims exactly one", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 0,
      holdMinutes: 0,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    const svc = globalService();

    const added = await svc.addEnrolment({
      cohortId,
      userId,
      target: "PENDING_PAYMENT",
      reason: "invoice raised",
    });
    expect(await seatsTaken(cohortId)).toBe(0);

    await svc.approveEnrolment({ enrolmentId: added.id, reason: "invoice paid" });
    expect(await seatsTaken(cohortId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Outbox + audit — exactly one DomainEvent per action, an AuditEvent naming
//    the actor and carrying the reason
// ---------------------------------------------------------------------------

describe("outbox and audit emission", () => {
  it("each of the five actions writes exactly one typed DomainEvent and an actor/reason AuditEvent", async () => {
    const svc = globalService();

    const src = await seedCohortFixture(testDb.prisma, { capacity: 9, seatsTaken: 0, holdMinutes: 30 });
    const transferTarget = await seedCohortFixture(testDb.prisma, {
      courseId: src.courseId,
      capacity: 9,
      seatsTaken: 0,
    });

    const check = async (
      type: string,
      action: string,
      reason: string,
      run: () => Promise<{ id?: string; sourceEnrolmentId?: string }>,
    ) => {
      const before = await countEvents(type);
      const result = await run();
      expect((await countEvents(type)) - before).toBe(1);
      const targetId = result.id ?? result.sourceEnrolmentId ?? null;
      const audit = await testDb.prisma.auditEvent.findFirst({
        where: { action, targetType: "Enrolment", targetId },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(actorId);
      expect(audit?.reason).toBe(reason);
    };

    const learnerA = (await seedLearnerFixture(testDb.prisma)).userId;
    const created = await (async () => {
      let out!: { id: string };
      await check("enrolment.created", "enrolment.created", "comp seat", async () => {
        out = await svc.addEnrolment({
          cohortId: src.cohortId,
          userId: learnerA,
          target: "PENDING_PAYMENT",
          reason: "comp seat",
        });
        return out;
      });
      return out;
    })();

    await check("enrolment.approved", "enrolment.approved", "confirmed", async () =>
      svc.approveEnrolment({ enrolmentId: created.id, reason: "confirmed" }),
    );

    await check("enrolment.transferred", "enrolment.transferred", "swap", async () =>
      svc.transferEnrolment({
        enrolmentId: created.id,
        targetCohortId: transferTarget.cohortId,
        reason: "swap",
      }).then((r) => ({ sourceEnrolmentId: r.sourceEnrolmentId })),
    );

    const learnerB = (await seedLearnerFixture(testDb.prisma)).userId;
    const toWithdraw = await svc.addEnrolment({
      cohortId: src.cohortId,
      userId: learnerB,
      target: "ACTIVE",
      reason: "seed for withdraw",
    });
    await check("enrolment.withdrawn", "enrolment.withdrawn", "left the programme", async () =>
      svc.withdrawEnrolment({ enrolmentId: toWithdraw.id, reason: "left the programme" }),
    );

    const learnerC = (await seedLearnerFixture(testDb.prisma)).userId;
    const toCancel = await svc.addEnrolment({
      cohortId: src.cohortId,
      userId: learnerC,
      target: "PENDING_PAYMENT",
      reason: "seed for cancel",
    });
    await check("enrolment.cancelled", "enrolment.cancelled", "never paid", async () =>
      svc.cancelEnrolment({ enrolmentId: toCancel.id, reason: "never paid" }),
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Terminal statuses
// ---------------------------------------------------------------------------

describe("terminal statuses", () => {
  it("withdrawing an already-WITHDRAWN enrolment throws IllegalTransitionError and writes no new DomainEvent", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 1,
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "WITHDRAWN",
    });

    const before = await countEvents("enrolment.withdrawn");
    await expect(
      globalService().withdrawEnrolment({ enrolmentId, reason: "again" }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(await countEvents("enrolment.withdrawn")).toBe(before);
  });
});
