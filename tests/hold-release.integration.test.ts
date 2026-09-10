/**
 * Real-Postgres proof for the hold-release sweep (COH-06, D-03).
 *
 * The sweep is the mechanism that reclaims a seat an abandoned checkout would
 * otherwise hold forever. This runs `createHoldReleaseSystemService` directly
 * against a throwaway `postgres:16-alpine` (see `tests/support/pg.ts`) with
 * the checked-in migrations deployed — including
 * `enrolment_hold_expiry_only_when_pending`, which is what makes "a
 * non-pending row with a past holdExpiresAt" impossible to seed at all.
 *
 * The Netlify Scheduled Function that invokes the sweep every five minutes is
 * covered by `tests/netlify-release-expired-holds.test.ts` and
 * `tests/release-expired-holds-task.test.ts`; this file proves
 * `releaseExpiredHolds` itself is correct, selective, idempotent, seat-exact,
 * audited as SYSTEM, and resilient to a poison row.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — the expected
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
} from "./support/cohort-fixtures";
import { createHoldReleaseSystemService } from "@/server/services/hold-release-system-service";
import { buildAuditRow } from "@/server/services/audit-service";
import { writeDomainEvent } from "@/server/services/domain-event-service";
import type { SeatTxClient } from "@/server/services/seat-accounting";
import type { DomainEventTxClient } from "@/server/services/domain-event-service";

let testDb: TestDatabase;

const FIXED_NOW = new Date("2026-09-04T12:00:00.000Z");
const PAST = new Date(FIXED_NOW.getTime() - 60_000); // 1 minute ago
const FUTURE = new Date(FIXED_NOW.getTime() + 60_000); // 1 minute from now

type ReleaseTx = SeatTxClient & DomainEventTxClient;

function buildService(now: () => Date = () => FIXED_NOW) {
  return createHoldReleaseSystemService({
    enrolment: {
      findMany: (args) =>
        testDb.prisma.enrolment.findMany({
          where: args.where,
          orderBy: args.orderBy,
          take: args.take,
          select: {
            id: true,
            cohortId: true,
            userId: true,
            status: true,
            holdExpiresAt: true,
          },
        }) as unknown as Promise<
          {
            id: string;
            cohortId: string;
            userId: string;
            status: string;
            holdExpiresAt: Date | null;
          }[]
        >,
    },
    audit: (event) =>
      testDb.prisma.auditEvent.create({ data: buildAuditRow(event) }) as unknown as Promise<void>,
    writeEvent: writeDomainEvent,
    runInTransaction: (fn) =>
      testDb.prisma.$transaction((tx) => fn(tx as unknown as ReleaseTx)),
    now,
  });
}

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

describe("releaseExpiredHolds — real Postgres (COH-06)", () => {
  it("releases a shared stale candidate only once across overlapping sweeps", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 3, seatsTaken: 2 });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId, status: "PENDING_PAYMENT", holdExpiresAt: PAST });
    await seedEnrolmentFixture(testDb.prisma, { cohortId, status: "ACTIVE" });
    const candidate = await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } });
    const service = createHoldReleaseSystemService({
      enrolment: { findMany: async () => [candidate] },
      runInTransaction: (fn) => testDb.prisma.$transaction((tx) => fn(tx as unknown as ReleaseTx)),
      writeEvent: writeDomainEvent, audit: async () => {}, now: () => FIXED_NOW,
    });
    const results = await Promise.all([service.releaseExpiredHolds(), service.releaseExpiredHolds()]);
    expect(results.reduce((sum, r) => sum + r.released, 0)).toBe(1);
    expect(results.reduce((sum, r) => sum + r.failed, 0)).toBe(0);
    expect((await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })).seatsTaken).toBe(1);
    const events = await testDb.prisma.domainEvent.findMany({ where: { type: "enrolment.hold_expired" } });
    expect(events.filter((e) => (e.payload as { enrolmentId: string }).enrolmentId === enrolmentId)).toHaveLength(1);
  });
  it("does not cancel an enrolment approved after the expiry candidate read", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 2, seatsTaken: 1 });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, { cohortId, status: "PENDING_PAYMENT", holdExpiresAt: PAST });
    const candidate = await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } });
    await testDb.prisma.enrolment.update({ where: { id: enrolmentId }, data: { status: "ACTIVE", holdExpiresAt: null } });
    const service = createHoldReleaseSystemService({
      enrolment: { findMany: async () => [candidate] },
      runInTransaction: (fn) => testDb.prisma.$transaction((tx) => fn(tx as unknown as ReleaseTx)),
      writeEvent: writeDomainEvent,
      audit: async () => {},
      now: () => FIXED_NOW,
    });
    expect((await service.releaseExpiredHolds()).released).toBe(0);
    expect((await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } })).status).toBe("ACTIVE");
    expect((await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })).seatsTaken).toBe(1);
  });
  it("case 1: releases an expired hold, cancels with reason, and returns the seat", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 1,
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: PAST,
    });

    const service = buildService();
    const result = await service.releaseExpiredHolds();

    expect(result.released).toBe(1);
    expect(result.failed).toBe(0);

    const enrolment = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: enrolmentId },
    });
    expect(enrolment.status).toBe("CANCELLED");
    expect(enrolment.reason).toBe("hold expired");
    expect(enrolment.holdExpiresAt).toBeNull();

    const cohort = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: cohortId },
    });
    expect(cohort.seatsTaken).toBe(0);
  });

  it("case 2: an unexpired hold stays PENDING_PAYMENT and seatsTaken is unchanged", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 1,
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: FUTURE,
    });

    const service = buildService();
    const result = await service.releaseExpiredHolds();

    expect(result.released).toBe(0);
    expect(result.failed).toBe(0);

    const enrolment = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: enrolmentId },
    });
    expect(enrolment.status).toBe("PENDING_PAYMENT");
    expect(enrolment.holdExpiresAt?.getTime()).toBe(FUTURE.getTime());

    const cohort = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: cohortId },
    });
    expect(cohort.seatsTaken).toBe(1);
  });

  it("case 3: a hold-less PENDING_PAYMENT enrolment (holdMinutes 0, D-02) is never swept", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
      holdMinutes: null,
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: null,
    });

    const service = buildService();
    const result = await service.releaseExpiredHolds();

    expect(result.released).toBe(0);

    const enrolment = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: enrolmentId },
    });
    expect(enrolment.status).toBe("PENDING_PAYMENT");

    const cohort = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: cohortId },
    });
    expect(cohort.seatsTaken).toBe(0);
  });

  it("case 4: ACTIVE, WITHDRAWN and CANCELLED rows are untouched", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 1,
    });
    const { enrolmentId: activeId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "ACTIVE",
    });
    const { enrolmentId: withdrawnId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "WITHDRAWN",
    });
    const { enrolmentId: cancelledId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "CANCELLED",
    });

    const service = buildService();
    const result = await service.releaseExpiredHolds();

    expect(result.released).toBe(0);

    const rows = await testDb.prisma.enrolment.findMany({
      where: { id: { in: [activeId, withdrawnId, cancelledId] } },
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(byId[activeId]).toBe("ACTIVE");
    expect(byId[withdrawnId]).toBe("WITHDRAWN");
    expect(byId[cancelledId]).toBe("CANCELLED");
  });

  it("case 5: a second immediate run is a zero-effect no-op", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 1,
    });
    await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: PAST,
    });

    const service = buildService();
    const first = await service.releaseExpiredHolds();
    expect(first.released).toBe(1);

    const auditCountAfterFirst = await testDb.prisma.auditEvent.count({
      where: { action: "enrolment.hold_expired" },
    });
    const domainEventCountAfterFirst = await testDb.prisma.domainEvent.count({
      where: { type: "enrolment.hold_expired" },
    });

    const second = await service.releaseExpiredHolds();
    expect(second.released).toBe(0);
    expect(second.failed).toBe(0);

    const auditCountAfterSecond = await testDb.prisma.auditEvent.count({
      where: { action: "enrolment.hold_expired" },
    });
    const domainEventCountAfterSecond = await testDb.prisma.domainEvent.count({
      where: { type: "enrolment.hold_expired" },
    });

    expect(auditCountAfterSecond).toBe(auditCountAfterFirst);
    expect(domainEventCountAfterSecond).toBe(domainEventCountAfterFirst);
  });

  it("case 6: a cohort already at seatsTaken 0 with an expired hold floors at 0", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 0,
    });
    await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: PAST,
    });

    const service = buildService();
    const result = await service.releaseExpiredHolds();
    expect(result.released).toBe(1);

    const cohort = await testDb.prisma.cohort.findUniqueOrThrow({
      where: { id: cohortId },
    });
    expect(cohort.seatsTaken).toBe(0);
  });

  it("case 7: each release writes exactly one SYSTEM AuditEvent and one DomainEvent", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 2,
      seatsTaken: 1,
    });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: PAST,
    });

    const service = buildService();
    await service.releaseExpiredHolds();

    const auditRows = await testDb.prisma.auditEvent.findMany({
      where: { targetType: "Enrolment", targetId: enrolmentId },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorId).toBeNull();
    expect(auditRows[0].actorType).toBe("SYSTEM");
    expect(auditRows[0].action).toBe("enrolment.hold_expired");

    const eventRows = await testDb.prisma.domainEvent.findMany({
      where: { type: "enrolment.hold_expired" },
    });
    const forThisEnrolment = eventRows.filter(
      (e) => (e.payload as { enrolmentId?: string }).enrolmentId === enrolmentId,
    );
    expect(forThisEnrolment).toHaveLength(1);
  });

  it("case 8: one bad row does not stall the sweep — the others still release", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 3,
    });
    const { enrolmentId: goodOne } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: PAST,
    });
    const { enrolmentId: poison } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: PAST,
    });
    const { enrolmentId: goodTwo } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: PAST,
    });

    // A disappeared candidate is now a harmless stale-state skip. Exercise
    // a genuine per-row write failure instead, after the seat write, proving
    // both rollback and continued processing.
    const originalFindMany = testDb.prisma.enrolment.findMany.bind(
      testDb.prisma.enrolment,
    );
    const enrolmentSpy = {
      findMany: async (args: Parameters<typeof originalFindMany>[0]) => {
        const rows = await originalFindMany(args);
        return rows;
      },
    };

    const service = createHoldReleaseSystemService({
      enrolment: enrolmentSpy as unknown as Parameters<
        typeof createHoldReleaseSystemService
      >[0]["enrolment"],
      audit: (event) =>
        testDb.prisma.auditEvent.create({ data: buildAuditRow(event) }) as unknown as Promise<void>,
      writeEvent: async (tx, event) => {
        if ((event.payload as { enrolmentId?: string }).enrolmentId === poison) {
          throw new Error("simulated per-row event write failure");
        }
        return writeDomainEvent(tx, event);
      },
      runInTransaction: (fn) =>
        testDb.prisma.$transaction((tx) => fn(tx as unknown as ReleaseTx)),
      now: () => FIXED_NOW,
    });

    const result = await service.releaseExpiredHolds();

    expect(result.released).toBe(2);
    expect(result.failed).toBe(1);

    const good1 = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: goodOne },
    });
    const good2 = await testDb.prisma.enrolment.findUniqueOrThrow({
      where: { id: goodTwo },
    });
    expect(good1.status).toBe("CANCELLED");
    expect(good2.status).toBe("CANCELLED");
    expect((await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: poison } })).status).toBe("PENDING_PAYMENT");
    expect((await testDb.prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } })).seatsTaken).toBe(1);
    // The next healthy sweep retries the rolled-back row, and leaves no
    // expired fixture behind for the following batch-limit test.
    expect((await buildService().releaseExpiredHolds()).released).toBe(1);
  });

  it("case 9: batchLimit caps a single run; the remainder releases on the next", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 3,
    });
    await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: PAST,
    });
    await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: PAST,
    });
    await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: PAST,
    });

    const service = buildService();
    const first = await service.releaseExpiredHolds(2);
    expect(first.released).toBe(2);

    const second = await service.releaseExpiredHolds(2);
    expect(second.released).toBe(1);

    const remaining = await testDb.prisma.enrolment.count({
      where: { cohortId, status: "PENDING_PAYMENT" },
    });
    expect(remaining).toBe(0);
  });
});
