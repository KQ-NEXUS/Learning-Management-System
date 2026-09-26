/**
 * Real-PostgreSQL proof of the stale ticket-attachment sweep (Phase 12 gap from 12-03/12-09).
 * Requires Docker (testcontainers); never touches the dev database.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

let testDb: TestDatabase;
let sweepModule: typeof import("@/server/services/upload-cleanup-system-service");

beforeAll(async () => {
  testDb = await startTestDatabase();
  process.env.DATABASE_URL = testDb.url;
  sweepModule = await import("@/server/services/upload-cleanup-system-service");
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

const HOUR = 60 * 60 * 1000;

async function seedTicketWithMessage() {
  const user = await testDb.prisma.user.create({
    data: { email: `sweep-${Date.now()}@example.test`, name: "Sweep Owner" },
    select: { id: true },
  });
  const ticket = await testDb.prisma.ticket.create({
    data: {
      reference: `KQT-SWEEP-${Date.now()}`,
      userId: user.id,
      category: "OTHER",
      subject: "Sweep",
    },
    select: { id: true },
  });
  const message = await testDb.prisma.ticketMessage.create({
    data: { ticketId: ticket.id, authorId: user.id, kind: "INITIAL", visibility: "PUBLIC", body: "Body" },
    select: { id: true },
  });
  return { userId: user.id, ticketId: ticket.id, messageId: message.id };
}

describe("stale ticket attachment sweep (real PostgreSQL)", () => {
  it(
    "removes only stale UPLOADING attachments, deletes their objects and audits them",
    async () => {
      const seed = await seedTicketWithMessage();
      const now = Date.now();
      const row = (key: string, uploadStatus: "UPLOADING" | "READY", ageHours: number) => ({
        ticketId: seed.ticketId,
        messageId: seed.messageId,
        uploadedById: seed.userId,
        storageKey: key,
        filename: `${key}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: BigInt(1024),
        uploadStatus,
        createdAt: new Date(now - ageHours * HOUR),
      });
      await testDb.prisma.ticketAttachment.createMany({
        data: [
          row("stale-uploading", "UPLOADING", 30),
          row("recent-uploading", "UPLOADING", 2),
          row("old-ready", "READY", 48),
        ],
      });

      const deleted: string[] = [];
      const audits: Array<{ action: string; targetType: string; actorId: string | null }> = [];
      const sweep = sweepModule.createUploadCleanupSystemService({
        lessonResource: testDb.prisma.lessonResource as never,
        ticketAttachment: testDb.prisma.ticketAttachment as never,
        deleteObject: async (key: string) => {
          deleted.push(key);
        },
        audit: async (event) => {
          audits.push({ action: event.action, targetType: event.targetType, actorId: event.actorId });
        },
      });

      const result = await sweep(new Date(now - 24 * HOUR), 50);

      expect(result).toEqual({ removed: 1, failed: 0 });
      expect(deleted).toEqual(["stale-uploading"]);
      expect(audits).toEqual([
        { action: "ticketattachment.upload_abandoned", targetType: "TicketAttachment", actorId: null },
      ]);
      const remaining = await testDb.prisma.ticketAttachment.findMany({
        orderBy: { storageKey: "asc" },
        select: { storageKey: true },
      });
      expect(remaining.map((r) => r.storageKey)).toEqual(["old-ready", "recent-uploading"]);
    },
    TEST_DB_TIMEOUT_MS,
  );
});
