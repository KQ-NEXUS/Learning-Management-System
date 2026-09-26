/**
 * Real-PostgreSQL cross-surface ownership/attachment proof (plan 12-09, SUP-01/SUP-02).
 * Requires Docker (testcontainers); never touches the dev database. Covers the
 * previously uncovered attachment intent/complete/download lifecycle against the
 * production Prisma repository (12-03 gap) with an in-memory object store.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createTestWithPermission } from "./support/harness";

let testDb: TestDatabase;
let ticketModule: typeof import("@/server/services/ticket-service");
let attModule: typeof import("@/server/services/ticket-attachment-service");

beforeAll(async () => {
  testDb = await startTestDatabase();
  process.env.DATABASE_URL = testDb.url;
  ticketModule = await import("@/server/services/ticket-service");
  attModule = await import("@/server/services/ticket-attachment-service");
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

function ticketSvc(userId: string) {
  const { withPermission } = createTestWithPermission([], { userId });
  return ticketModule.createPrismaBackedTicketService(testDb.prisma as never, {
    getActor: async () => ({ userId }),
    withPermission,
  });
}

function makeStore() {
  const objects = new Map<string, { sizeBytes: bigint; contentType: string | null }>();
  let seq = 0;
  return {
    objects,
    storage: {
      buildStagedKey: (ticketId: string) => `staged/${ticketId}/${(seq += 1)}`,
      finalKey: (staged: string) => staged.replace("staged/", "final/"),
      presignPut: async ({ key }: { key: string }) => `https://r2.invalid/${key}?sig=redacted`,
      inspect: async (key: string) => {
        const o = objects.get(key);
        if (!o) throw new Error("missing");
        return o;
      },
      promote: async ({ stagedKey, finalKey }: { stagedKey: string; finalKey: string }) => {
        const o = objects.get(stagedKey);
        if (o) objects.set(finalKey, o);
      },
      delete: async (key: string) => {
        objects.delete(key);
      },
    },
  };
}

function attSvc(userId: string, perms: string[], store: ReturnType<typeof makeStore>) {
  return attModule.createTicketAttachmentService({
    repository: attModule.createPrismaTicketAttachmentRepository(testDb.prisma),
    storage: store.storage,
    getActor: async () => ({ userId }),
    hasPermission: async (p) => perms.includes(p),
    audit: async () => undefined,
  });
}

describe("ticket ownership parity (real PostgreSQL)", () => {
  it("denies a stranger list/detail/reply/reopen/close with the same not-found as a missing ticket", async () => {
    const owner = await makeUser("owner");
    const stranger = await makeUser("stranger");
    const t = await ticketSvc(owner.id).createOwnTicket({ category: "OTHER", subject: "Mine", body: "Owner body" });
    const s = ticketSvc(stranger.id);

    expect(await s.listOwnTickets()).toHaveLength(0);
    const NotFound = ticketModule.TicketNotFoundError;
    await expect(s.getOwnTicketByReference(t.reference)).rejects.toBeInstanceOf(NotFound);
    await expect(s.getOwnTicketByReference("TKT-DOES-NOT-EXIST")).rejects.toBeInstanceOf(NotFound);
    await expect(
      s.addOwnReply({ reference: t.reference, expectedVersion: t.version, body: "x" }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      s.reopenOwnTicket({ reference: t.reference, expectedVersion: t.version, reason: "why" }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(s.closeOwnTicket({ reference: t.reference, expectedVersion: t.version })).rejects.toBeInstanceOf(
      NotFound,
    );
    expect(await testDb.prisma.ticketMessage.count({ where: { ticketId: t.id } })).toBe(1);
  });
});

describe("attachment lifecycle against the production repository (real PostgreSQL)", () => {
  it("runs intent -> complete -> download, enforces the 3-file cap and rejects a fourth", async () => {
    const owner = await makeUser("owner");
    const t = await ticketSvc(owner.id).createOwnTicket({ category: "OTHER", subject: "Files", body: "Body" });
    const store = makeStore();
    const svc = attSvc(owner.id, [], store);

    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const intent = await svc.createUploadIntent({
        messageId: t.initialMessageId,
        filename: `../evil"${i}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 100 + i,
      });
      expect(intent.attachment.filename).not.toMatch(/[\\/"]/);
      ids.push(intent.attachment.id);
    }
    await expect(
      svc.createUploadIntent({ messageId: t.initialMessageId, filename: "d.pdf", mimeType: "application/pdf", sizeBytes: 5 }),
    ).rejects.toBeInstanceOf(attModule.TicketAttachmentValidationError);
    await expect(
      svc.createUploadIntent({ messageId: t.initialMessageId, filename: "d.exe", mimeType: "application/x-msdownload", sizeBytes: 5 }),
    ).rejects.toBeInstanceOf(attModule.TicketAttachmentValidationError);
    await expect(
      svc.createUploadIntent({ messageId: t.initialMessageId, filename: "big.pdf", mimeType: "application/pdf", sizeBytes: 10 * 1024 * 1024 + 1 }),
    ).rejects.toBeInstanceOf(attModule.TicketAttachmentValidationError);

    // Not READY yet: download denied identically to a missing id.
    await expect(svc.getDownload(ids[0])).rejects.toBeInstanceOf(attModule.TicketAttachmentNotFoundError);

    const row = await testDb.prisma.ticketAttachment.findUniqueOrThrow({ where: { id: ids[0] } });
    store.objects.set(row.storageKey, { sizeBytes: row.sizeBytes, contentType: "application/pdf" });
    const done = await svc.completeUpload(ids[0]);
    expect(done.uploadStatus).toBe("READY");
    expect((await svc.completeUpload(ids[0])).uploadStatus).toBe("READY"); // idempotent
    const dl = await svc.getDownload(ids[0]);
    expect(dl.storageKey.startsWith("final/")).toBe(true);

    // Size mismatch -> ERROR, staged object removed, never downloadable.
    const bad = await testDb.prisma.ticketAttachment.findUniqueOrThrow({ where: { id: ids[1] } });
    store.objects.set(bad.storageKey, { sizeBytes: bad.sizeBytes + BigInt(1), contentType: "application/pdf" });
    await expect(svc.completeUpload(ids[1])).rejects.toBeInstanceOf(attModule.TicketAttachmentConflictError);
    expect(store.objects.has(bad.storageKey)).toBe(false);
    expect((await testDb.prisma.ticketAttachment.findUniqueOrThrow({ where: { id: ids[1] } })).uploadStatus).toBe("ERROR");
    await expect(svc.getDownload(ids[1])).rejects.toBeInstanceOf(attModule.TicketAttachmentNotFoundError);
  });

  it("gives a stranger and the owner (for internal notes) the same denial; staff with tickets.view can download", async () => {
    const owner = await makeUser("owner");
    const stranger = await makeUser("stranger");
    const staff = await makeUser("staff");
    const t = await ticketSvc(owner.id).createOwnTicket({ category: "OTHER", subject: "Download check", body: "Body" });
    const note = await testDb.prisma.ticketMessage.create({
      data: { ticketId: t.id, authorId: staff.id, kind: "INTERNAL_NOTE", visibility: "INTERNAL", body: "NOTE-SENTINEL" },
    });
    const store = makeStore();
    const pub = await testDb.prisma.ticketAttachment.create({
      data: { ticketId: t.id, messageId: t.initialMessageId, uploadedById: owner.id, storageKey: "final/pub", filename: "public-sentinel.pdf", mimeType: "application/pdf", sizeBytes: BigInt(1), uploadStatus: "READY" },
    });
    const priv = await testDb.prisma.ticketAttachment.create({
      data: { ticketId: t.id, messageId: note.id, uploadedById: staff.id, storageKey: "final/priv", filename: "internal-sentinel.pdf", mimeType: "application/pdf", sizeBytes: BigInt(1), uploadStatus: "READY" },
    });
    const NotFound = attModule.TicketAttachmentNotFoundError;

    await expect(attSvc(owner.id, [], store).getDownload(pub.id)).resolves.toMatchObject({ storageKey: "final/pub" });
    await expect(attSvc(stranger.id, [], store).getDownload(pub.id)).rejects.toBeInstanceOf(NotFound);
    await expect(attSvc(stranger.id, [], store).getDownload("no-such-id")).rejects.toBeInstanceOf(NotFound);
    await expect(attSvc(owner.id, [], store).getDownload(priv.id)).rejects.toBeInstanceOf(NotFound);
    await expect(attSvc(staff.id, ["tickets.view"], store).getDownload(priv.id)).resolves.toMatchObject({ storageKey: "final/priv" });

    // Uploads: owner cannot attach to an internal note or another user's message.
    await expect(
      attSvc(owner.id, [], store).createUploadIntent({ messageId: note.id, filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      attSvc(stranger.id, [], store).createUploadIntent({ messageId: t.initialMessageId, filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 }),
    ).rejects.toBeInstanceOf(NotFound);
    // Staff with only view (no manage) cannot upload.
    await expect(
      attSvc(staff.id, ["tickets.view"], store).createUploadIntent({ messageId: t.initialMessageId, filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 }),
    ).rejects.toBeInstanceOf(NotFound);
    // Staff with manage can attach to an internal note (staff attachment path).
    await expect(
      attSvc(staff.id, ["tickets.manage"], store).createUploadIntent({ messageId: note.id, filename: "s.pdf", mimeType: "application/pdf", sizeBytes: 1 }),
    ).resolves.toMatchObject({ attachment: { uploadStatus: "UPLOADING" } });

    // Learner projection: sentinels absent, staff filenames absent.
    const detail = JSON.stringify(await ticketSvc(owner.id).getOwnTicketByReference(t.reference));
    const list = JSON.stringify(await ticketSvc(owner.id).listOwnTickets());
    for (const s of ["NOTE-SENTINEL", "internal-sentinel", "final/priv", priv.id, note.id]) {
      expect(detail).not.toContain(s);
      expect(list).not.toContain(s);
    }
    expect(detail).toContain("public-sentinel.pdf");
    expect(detail).not.toContain("final/pub"); // storage key never serialized
  });
});
