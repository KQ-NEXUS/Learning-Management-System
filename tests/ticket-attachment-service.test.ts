import { describe, expect, it, vi } from "vitest";
import {
  createTicketAttachmentService,
  TicketAttachmentConflictError,
  TicketAttachmentNotFoundError,
  TicketAttachmentValidationError,
  type TicketAttachmentRow,
  type TicketMessageAuthContext,
} from "@/server/services/ticket-attachment-service";
import {
  buildStagedTicketAttachmentKey,
  finalTicketAttachmentKeyFor,
} from "@/server/services/storage-service";

const MIB = 1024 * 1024;

type Row = TicketAttachmentRow;

function harness(options?: {
  visibility?: "PUBLIC" | "INTERNAL";
  actorId?: string;
  perms?: string[];
  stored?: { sizeBytes: bigint; contentType: string | null };
}) {
  const message: TicketMessageAuthContext = {
    id: "m1",
    ticketId: "t1",
    visibility: options?.visibility ?? "PUBLIC",
    ticketOwnerId: "learner",
  };
  const rows = new Map<string, Row>();
  let seq = 0;
  const storage = {
    buildStagedKey: (ticketId: string) => buildStagedTicketAttachmentKey({ ticketId }),
    finalKey: finalTicketAttachmentKeyFor,
    presignPut: vi.fn(async () => "https://storage.example/put"),
    inspect: vi.fn(async () => options?.stored ?? { sizeBytes: 1000n, contentType: "image/png" }),
    promote: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  const repository = {
    findMessage: vi.fn(async (id: string) => (id === message.id ? message : null)),
    createIfUnderCap: vi.fn(async (data: Omit<Row, "id" | "uploadStatus">, cap: number) => {
      const active = [...rows.values()].filter(
        (r) => r.messageId === data.messageId && r.uploadStatus !== "ERROR",
      );
      if (active.length >= cap) return null;
      const row: Row = { ...data, id: `a${++seq}`, uploadStatus: "UPLOADING" };
      rows.set(row.id, row);
      return row;
    }),
    findAttachment: vi.fn(async (id: string) => {
      const row = rows.get(id);
      return row ? { ...row, message } : null;
    }),
    markReady: vi.fn(async (id: string, finalKey: string) => {
      const row = rows.get(id);
      if (!row || row.uploadStatus !== "UPLOADING") return false;
      row.uploadStatus = "READY";
      row.storageKey = finalKey;
      return true;
    }),
    markError: vi.fn(async (id: string) => {
      const row = rows.get(id);
      if (row) row.uploadStatus = "ERROR";
    }),
  };
  const perms = options?.perms ?? [];
  const audit = vi.fn(async () => undefined);
  const service = createTicketAttachmentService({
    repository,
    storage,
    getActor: async () => ({ userId: options?.actorId ?? "learner" }) as never,
    hasPermission: async (p) => perms.includes(p),
    audit,
  });
  return { service, rows, storage, repository, audit };
}

const png = { messageId: "m1", filename: "shot.png", mimeType: "image/png", sizeBytes: 1000 };

describe("ticket attachment intent", () => {
  it.each(["image/png", "image/jpeg", "image/webp", "application/pdf"])(
    "accepts %s",
    async (mimeType) => {
      const { service } = harness();
      const result = await service.createUploadIntent({ ...png, mimeType });
      expect(result.upload.method).toBe("PUT");
      expect(result.upload.expiresIn).toBe(900);
    },
  );

  it.each(["image/svg+xml", "text/html", "application/zip", "application/x-msdownload",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"])(
    "rejects active/unsupported type %s",
    async (mimeType) => {
      const { service, repository } = harness();
      await expect(service.createUploadIntent({ ...png, mimeType })).rejects.toBeInstanceOf(
        TicketAttachmentValidationError,
      );
      expect(repository.createIfUnderCap).not.toHaveBeenCalled();
    },
  );

  it("accepts exactly 10 MiB and rejects one byte more", async () => {
    const { service } = harness();
    await expect(service.createUploadIntent({ ...png, sizeBytes: 10 * MIB })).resolves.toBeDefined();
    await expect(
      service.createUploadIntent({ ...png, sizeBytes: 10 * MIB + 1 }),
    ).rejects.toBeInstanceOf(TicketAttachmentValidationError);
  });

  it("rejects the fourth file on one message", async () => {
    const { service } = harness();
    for (let i = 0; i < 3; i += 1) await service.createUploadIntent(png);
    await expect(service.createUploadIntent(png)).rejects.toBeInstanceOf(
      TicketAttachmentValidationError,
    );
  });

  it("denies a learner on an internal message as not found, before validating", async () => {
    const { service, repository } = harness({ visibility: "INTERNAL" });
    await expect(
      service.createUploadIntent({ ...png, mimeType: "text/html" }),
    ).rejects.toBeInstanceOf(TicketAttachmentNotFoundError);
    expect(repository.createIfUnderCap).not.toHaveBeenCalled();
  });

  it("denies a stranger and an unknown message identically", async () => {
    const stranger = harness({ actorId: "other" });
    await expect(stranger.service.createUploadIntent(png)).rejects.toBeInstanceOf(
      TicketAttachmentNotFoundError,
    );
    const unknown = harness();
    await expect(
      unknown.service.createUploadIntent({ ...png, messageId: "nope" }),
    ).rejects.toBeInstanceOf(TicketAttachmentNotFoundError);
  });

  it("lets tickets.manage staff attach to an internal note", async () => {
    const { service } = harness({
      visibility: "INTERNAL",
      actorId: "staff",
      perms: ["tickets.manage"],
    });
    await expect(service.createUploadIntent(png)).resolves.toBeDefined();
  });

  it("uses random keys that never contain the filename", async () => {
    const { service, rows } = harness();
    await service.createUploadIntent({ ...png, filename: "secret-passport.png" });
    const key = [...rows.values()][0]!.storageKey;
    expect(key).toMatch(/^ticket-uploads\/t1\/[0-9a-f-]{36}$/);
    expect(key).not.toContain("passport");
  });

  it("sanitizes stored filenames", async () => {
    const { service, rows } = harness();
    await service.createUploadIntent({ ...png, filename: '../..\\a"b.png' });
    const name = [...rows.values()][0]!.filename;
    expect(name).not.toMatch(/[\\/"]/);
  });
});

describe("ticket attachment completion", () => {
  it("promotes on matching metadata and is idempotent", async () => {
    const { service, storage } = harness();
    const { attachment } = await service.createUploadIntent(png);
    const first = await service.completeUpload(attachment.id);
    expect(first.uploadStatus).toBe("READY");
    expect(storage.promote).toHaveBeenCalledTimes(1);
    const retry = await service.completeUpload(attachment.id);
    expect(retry.uploadStatus).toBe("READY");
    expect(storage.promote).toHaveBeenCalledTimes(1);
  });

  it("never yields READY on a size mismatch", async () => {
    const { service, rows, storage } = harness({
      stored: { sizeBytes: 999n, contentType: "image/png" },
    });
    const { attachment } = await service.createUploadIntent(png);
    await expect(service.completeUpload(attachment.id)).rejects.toBeInstanceOf(
      TicketAttachmentConflictError,
    );
    expect(rows.get(attachment.id)!.uploadStatus).toBe("ERROR");
    expect(storage.delete).toHaveBeenCalled();
    expect(storage.promote).not.toHaveBeenCalled();
  });

  it("never yields READY on a content type mismatch", async () => {
    const { service, rows } = harness({
      stored: { sizeBytes: 1000n, contentType: "text/html" },
    });
    const { attachment } = await service.createUploadIntent(png);
    await expect(service.completeUpload(attachment.id)).rejects.toBeInstanceOf(
      TicketAttachmentConflictError,
    );
    expect(rows.get(attachment.id)!.uploadStatus).toBe("ERROR");
  });

  it("denies completion for a non-owner as not found", async () => {
    const owner = harness();
    const { attachment } = await owner.service.createUploadIntent(png);
    const other = createTicketAttachmentService({
      repository: owner.repository,
      storage: owner.storage,
      getActor: async () => ({ userId: "stranger" }) as never,
      hasPermission: async () => false,
      audit: owner.audit,
    });
    await expect(other.completeUpload(attachment.id)).rejects.toBeInstanceOf(
      TicketAttachmentNotFoundError,
    );
  });
});
