/**
 * Real-Postgres proof of migration
 * `20261003120000_mark_pre_notification_event_backlog_processed` (audit A-14).
 *
 * Phases 5-12 wrote DomainEvent rows before any consumer existed, and the
 * phase 13 drain claims every row with a NULL processedAt. This re-runs the
 * checked-in migration SQL against rows shaped like that backlog and asserts
 * exactly which ones the drain is still allowed to see.
 *
 * PREREQUISITE: Docker must be running (tests/support/pg.ts starts the
 * container). If it is not, `beforeAll` fails with a container-start error —
 * every case reports BLOCKED, never a silent pass.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

const MIGRATION_SQL = readFileSync(
  path.resolve(
    __dirname,
    "..",
    "prisma",
    "migrations",
    "20261003120000_mark_pre_notification_event_backlog_processed",
    "migration.sql",
  ),
  "utf8",
);

const HOUR_MS = 60 * 60_000;

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

describe("A-14 — the pre-notification DomainEvent backlog is never drained", () => {
  it("marks old pending events processed, leaves fresh pending events for the drain, and touches nothing else", async () => {
    const now = Date.now();
    const poisonedAt = new Date(now - 10 * 24 * HOUR_MS);
    const alreadyProcessedAt = new Date(now - 5 * 24 * HOUR_MS);

    const oldPending = await testDb.prisma.domainEvent.create({
      data: { type: "cohort.cancelled", payload: { cohortId: "c-old" }, occurredAt: new Date(now - 26 * 24 * HOUR_MS) },
    });
    const justOverAnHour = await testDb.prisma.domainEvent.create({
      data: { type: "enrolment.withdrawn", payload: { enrolmentId: "e-old" }, occurredAt: new Date(now - 2 * HOUR_MS) },
    });
    const freshPending = await testDb.prisma.domainEvent.create({
      data: { type: "ticket.created", payload: { ticketId: "t-new" }, occurredAt: new Date(now - 5 * 60_000) },
    });
    const poisoned = await testDb.prisma.domainEvent.create({
      data: {
        type: "grade.released",
        payload: { gradeId: "g-poison" },
        occurredAt: new Date(now - 11 * 24 * HOUR_MS),
        processedAt: poisonedAt,
        attempts: 3,
        lastError: "mapper failed",
      },
    });
    const alreadyProcessed = await testDb.prisma.domainEvent.create({
      data: {
        type: "order.paid",
        payload: { orderId: "o-done" },
        occurredAt: new Date(now - 6 * 24 * HOUR_MS),
        processedAt: alreadyProcessedAt,
      },
    });

    await testDb.prisma.$executeRawUnsafe(MIGRATION_SQL);

    const byId = async (id: string) => testDb.prisma.domainEvent.findUniqueOrThrow({ where: { id } });

    // The backlog: processed, and NOT poison-marked (lastError stays null, D-04).
    for (const row of [await byId(oldPending.id), await byId(justOverAnHour.id)]) {
      expect(row.processedAt).not.toBeNull();
      expect(row.lastError).toBeNull();
      expect(row.attempts).toBe(0);
    }

    // A fresh pending event is still the drain's to claim.
    expect((await byId(freshPending.id)).processedAt).toBeNull();

    // Rows that were already settled keep their own timestamps and error.
    const poisonedAfter = await byId(poisoned.id);
    expect(poisonedAfter.processedAt?.getTime()).toBe(poisonedAt.getTime());
    expect(poisonedAfter.lastError).toBe("mapper failed");
    expect((await byId(alreadyProcessed.id)).processedAt?.getTime()).toBe(alreadyProcessedAt.getTime());

    // What the drain's claim query would see now.
    const stillPending = await testDb.prisma.domainEvent.findMany({ where: { processedAt: null } });
    expect(stillPending.map((row) => row.id)).toEqual([freshPending.id]);
  }, 60_000);

  it("is safe to run again: a second run changes nothing", async () => {
    const before = await testDb.prisma.domainEvent.findMany({ orderBy: { id: "asc" } });
    await testDb.prisma.$executeRawUnsafe(MIGRATION_SQL);
    const after = await testDb.prisma.domainEvent.findMany({ orderBy: { id: "asc" } });

    expect(after.map((row) => [row.id, row.processedAt === null])).toEqual(
      before.map((row) => [row.id, row.processedAt === null]),
    );
  }, 60_000);
});
