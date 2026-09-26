/**
 * Real-Postgres proof for the learner reply path and the public-only learner
 * projection (plan 12-05). Requires Docker (testcontainers); never touches the
 * dev database. Services are imported after the container starts because
 * `@/server/db` reads DATABASE_URL on first evaluation.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createTestWithPermission } from "./support/harness";

let testDb: TestDatabase;
let serviceModule: typeof import("@/server/services/ticket-service");

beforeAll(async () => {
  testDb = await startTestDatabase();
  process.env.DATABASE_URL = testDb.url;
  serviceModule = await import("@/server/services/ticket-service");
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

let n = 0;
async function makeUser(prefix: string) {
  n += 1;
  return testDb.prisma.user.create({
    data: { email: `${prefix}-${n}-${Date.now()}@example.test`, name: prefix },
    select: { id: true },
  });
}

function learner(userId: string, now?: () => Date) {
  const { withPermission } = createTestWithPermission([], { userId });
  return serviceModule.createPrismaBackedTicketService(testDb.prisma as never, {
    getActor: async () => ({ userId }),
    withPermission,
    now,
  });
}

describe("learner reply and detail (real PostgreSQL)", () => {
  it("creates once, replies with a version guard, and rejects a stale or foreign reply", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");
    const svc = learner(owner.id);
    const created = await svc.createOwnTicket({ category: "OTHER", subject: "Help me", body: "Initial body" });
    expect(created.initialMessageId).toBeTruthy();

    const sent = await svc.addOwnReply({ reference: created.reference, expectedVersion: created.version, body: "Follow-up" });
    expect(sent.messageId).toBeTruthy();

    // The same expected version is now stale; no duplicate message is written.
    await expect(
      svc.addOwnReply({ reference: created.reference, expectedVersion: created.version, body: "Stale" }),
    ).rejects.toBeInstanceOf(serviceModule.StaleTicketVersionError);
    expect(await testDb.prisma.ticketMessage.count({ where: { ticketId: created.id } })).toBe(2);

    await expect(
      learner(other.id).addOwnReply({ reference: created.reference, expectedVersion: created.version + 1, body: "Nope" }),
    ).rejects.toBeInstanceOf(serviceModule.TicketNotFoundError);
  });

  it("never returns internal notes or non-READY attachments in the learner detail", async () => {
    const owner = await makeUser("owner");
    const staff = await makeUser("staff");
    const svc = learner(owner.id);
    const created = await svc.createOwnTicket({ category: "CERTIFICATE", subject: "Cert", body: "Public initial" });
    await testDb.prisma.ticketMessage.create({
      data: { ticketId: created.id, authorId: staff.id, kind: "INTERNAL_NOTE", visibility: "INTERNAL", body: "INTERNAL-SENTINEL" },
    });
    await testDb.prisma.ticketAttachment.create({
      data: {
        ticketId: created.id,
        messageId: created.initialMessageId,
        uploadedById: owner.id,
        storageKey: "staged/never",
        filename: "half.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(10),
        uploadStatus: "UPLOADING",
      },
    });

    const detail = await svc.getOwnTicketByReference(created.reference);
    const json = JSON.stringify(detail);
    expect(json).not.toContain("INTERNAL-SENTINEL");
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0].attachments).toHaveLength(0);
    expect(detail.messages[0].authorRole).toBe("LEARNER");
  });

  it("reopens at the exact seven-day boundary and refuses one millisecond later", async () => {
    const owner = await makeUser("owner");
    const resolvedAt = new Date("2026-09-01T12:00:00.000Z");
    const svcAt = (ms: number) => learner(owner.id, () => new Date(resolvedAt.getTime() + ms));
    const week = 7 * 86_400_000;

    for (const [offset, ok] of [[week, true], [week + 1, false]] as const) {
      const base = learner(owner.id);
      const t = await base.createOwnTicket({ category: "OTHER", subject: "Grace", body: "Body text" });
      await testDb.prisma.ticket.update({ where: { id: t.id }, data: { status: "RESOLVED", resolvedAt } });
      const attempt = svcAt(offset).reopenOwnTicket({ reference: t.reference, expectedVersion: t.version, reason: "Still broken" });
      if (ok) await expect(attempt).resolves.toMatchObject({ status: "OPEN" });
      else await expect(attempt).rejects.toThrow("can no longer be reopened");
    }
  });
});
