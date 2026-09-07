/**
 * Real-Postgres proof for the seat-accounting primitive (D-04, D-05, D-15).
 *
 * The phase's highest-risk mechanism is capacity under concurrency: the row
 * lock in `takeSeat` must be what refuses the loser, and the
 * `cohort_capacity_not_exceeded` CHECK must stay a backstop that never fires.
 * A mock cannot raise a real lock-wait or a real partial-unique-index P2002,
 * so this runs against a throwaway `postgres:16-alpine` (see
 * `tests/support/pg.ts`) with the checked-in migrations deployed.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error and every case reports BLOCKED — that is the expected
 * failure mode, never a silent pass or a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  TEST_DB_TIMEOUT_MS,
  type TestDatabase,
} from "./support/pg";
import {
  seedCohortFixture,
  seedEnrolmentFixture,
  seedLearnerFixture,
} from "./support/cohort-fixtures";
import {
  AlreadyEnrolledError,
  CapacityExceededError,
  holdsSeat,
  releaseSeat,
  takeSeat,
  type SeatTxClient,
} from "@/server/services/seat-accounting";

let testDb: TestDatabase;

const asSeatTx = (tx: unknown): SeatTxClient => tx as SeatTxClient;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

describe("takeSeat — capacity under concurrency (D-05)", () => {
  it("two concurrent takes on a capacity-1 cohort produce exactly one enrolment", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 1,
      seatsTaken: 0,
    });
    const { userId: userA } = await seedLearnerFixture(testDb.prisma);
    const { userId: userB } = await seedLearnerFixture(testDb.prisma);

    const results = await Promise.allSettled([
      testDb.prisma.$transaction(
        (tx) =>
          takeSeat(asSeatTx(tx), {
            cohortId,
            enrolment: { cohortId, userId: userA, status: "ACTIVE" },
          }),
        { timeout: 15_000 },
      ),
      testDb.prisma.$transaction(
        (tx) =>
          takeSeat(asSeatTx(tx), {
            cohortId,
            enrolment: { cohortId, userId: userB, status: "ACTIVE" },
          }),
        { timeout: 15_000 },
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(CapacityExceededError);
    // The CHECK constraint must never be the party that refuses.
    expect(String((reason as Error)?.message ?? reason)).not.toMatch(
      /cohort_capacity_not_exceeded/,
    );

    const cohort = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: cohortId },
    });
    expect(cohort.seatsTaken).toBe(1);
    expect(await testDb.prisma.enrolment.count({ where: { cohortId } })).toBe(1);
  });

  it("a capacity refusal on a full cohort inserts nothing and leaves seatsTaken unchanged", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 1,
      seatsTaken: 1,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma);

    await expect(
      testDb.prisma.$transaction((tx) =>
        takeSeat(asSeatTx(tx), {
          cohortId,
          enrolment: { cohortId, userId, status: "ACTIVE" },
        }),
      ),
    ).rejects.toBeInstanceOf(CapacityExceededError);

    const cohort = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: cohortId },
    });
    expect(cohort.seatsTaken).toBe(1);
    expect(await testDb.prisma.enrolment.count({ where: { cohortId } })).toBe(0);
  });
});

describe("takeSeat — duplicate active and re-enrolment (D-15)", () => {
  it("a second ACTIVE enrolment for the same learner rejects as AlreadyEnrolledError", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 0,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma);

    await testDb.prisma.$transaction((tx) =>
      takeSeat(asSeatTx(tx), {
        cohortId,
        enrolment: { cohortId, userId, status: "ACTIVE" },
      }),
    );

    const reason = await testDb.prisma
      .$transaction((tx) =>
        takeSeat(asSeatTx(tx), {
          cohortId,
          enrolment: { cohortId, userId, status: "ACTIVE" },
        }),
      )
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(reason).toBeInstanceOf(AlreadyEnrolledError);
    expect((reason as { constructor: { name: string } }).constructor.name).toBe(
      "AlreadyEnrolledError",
    );
    expect((reason as AlreadyEnrolledError).userId).toBe(userId);
    expect((reason as AlreadyEnrolledError).cohortId).toBe(cohortId);
  });

  it("re-enrolment after releaseSeat -> WITHDRAWN succeeds — the guard is the partial index on ACTIVE only", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 0,
    });
    const { userId } = await seedLearnerFixture(testDb.prisma);

    const first = await testDb.prisma.$transaction((tx) =>
      takeSeat(asSeatTx(tx), {
        cohortId,
        enrolment: { cohortId, userId, status: "ACTIVE" },
      }),
    );

    await testDb.prisma.$transaction((tx) =>
      releaseSeat(asSeatTx(tx), {
        cohortId,
        enrolmentId: first.id,
        toStatus: "WITHDRAWN",
        reason: "Learner requested withdrawal",
        heldSeat: true,
        withdrawnAt: new Date(),
      }),
    );

    const second = await testDb.prisma.$transaction((tx) =>
      takeSeat(asSeatTx(tx), {
        cohortId,
        enrolment: { cohortId, userId, status: "ACTIVE" },
      }),
    );

    expect(second.id).not.toBe(first.id);
    const cohort = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: cohortId },
    });
    // 0 -> 1 (take) -> 0 (release) -> 1 (re-take)
    expect(cohort.seatsTaken).toBe(1);
  });
});

describe("releaseSeat — decrement floors at 0 (D-04)", () => {
  it("floors at 0 when seatsTaken is already 0", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 0,
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "ACTIVE",
    });

    await testDb.prisma.$transaction((tx) =>
      releaseSeat(asSeatTx(tx), {
        cohortId,
        enrolmentId,
        toStatus: "CANCELLED",
        reason: "administrative cancellation",
        heldSeat: true,
      }),
    );

    expect(
      (
        await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })
      ).seatsTaken,
    ).toBe(0);
  });

  it("a normal release decrements by exactly 1", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 2,
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "ACTIVE",
    });

    await testDb.prisma.$transaction((tx) =>
      releaseSeat(asSeatTx(tx), {
        cohortId,
        enrolmentId,
        toStatus: "WITHDRAWN",
        reason: "withdrawn by staff",
        heldSeat: true,
        withdrawnAt: new Date(),
      }),
    );

    expect(
      (
        await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })
      ).seatsTaken,
    ).toBe(1);
  });

  it("heldSeat: false does not decrement at all", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 2,
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
    });

    await testDb.prisma.$transaction((tx) =>
      releaseSeat(asSeatTx(tx), {
        cohortId,
        enrolmentId,
        toStatus: "CANCELLED",
        reason: "hold lapsed, no seat held",
        heldSeat: false,
      }),
    );

    expect(
      (
        await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })
      ).seatsTaken,
    ).toBe(2);
  });
});

describe("releaseSeat — hold coherence and holdsSeat against real rows", () => {
  it("releaseSeat nulls holdExpiresAt so enrolment_hold_expiry_only_when_pending is satisfied", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 1,
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: new Date(Date.now() + 1_800_000),
    });

    await testDb.prisma.$transaction((tx) =>
      releaseSeat(asSeatTx(tx), {
        cohortId,
        enrolmentId,
        toStatus: "CANCELLED",
        reason: "hold released",
        heldSeat: true,
      }),
    );

    const row = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: enrolmentId },
    });
    expect(row.status).toBe("CANCELLED");
    expect(row.holdExpiresAt).toBeNull();
  });

  it("holdsSeat: ACTIVE -> true, PENDING_PAYMENT with a hold -> true, PENDING_PAYMENT without -> false", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 0,
    });
    const active = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "ACTIVE",
    });
    const held = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: new Date(Date.now() + 1_800_000),
    });
    const unheld = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
    });

    const rows = await testDb.prisma.enrolment.findMany({
      where: {
        id: { in: [active.enrolmentId, held.enrolmentId, unheld.enrolmentId] },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(holdsSeat(byId.get(active.enrolmentId)!)).toBe(true);
    expect(holdsSeat(byId.get(held.enrolmentId)!)).toBe(true);
    expect(holdsSeat(byId.get(unheld.enrolmentId)!)).toBe(false);
  });
});
