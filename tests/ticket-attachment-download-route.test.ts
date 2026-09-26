import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  NotFound: class TicketAttachmentNotFoundError extends Error {},
  getTicketAttachmentDownload: vi.fn(),
  presignLessonObjectUrl: vi.fn(async () => "https://s3.example/o?sig=1"),
}));


vi.mock("@/server/services/ticket-attachment-service", () => ({
  getTicketAttachmentDownload: h.getTicketAttachmentDownload,
  TicketAttachmentNotFoundError: h.NotFound,
}));
vi.mock("@/server/services/storage-service", () => ({
  presignLessonObjectUrl: h.presignLessonObjectUrl,
}));

import { GET } from "@/app/api/ticket-attachments/[attachmentId]/download/route";

const call = (id: string) =>
  GET(new Request("http://localhost/x"), { params: Promise.resolve({ attachmentId: id }) });

beforeEach(() => vi.clearAllMocks());

describe("ticket attachment download route", () => {
  it("redirects an authorized download with no-store and awaited params", async () => {
    h.getTicketAttachmentDownload.mockResolvedValue({
      storageKey: "ticket-attachments/t1/k",
      filename: "shot.png",
      mimeType: "image/png",
    });
    const res = await call("a1");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://s3.example/o?sig=1");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(h.getTicketAttachmentDownload).toHaveBeenCalledWith("a1");
    expect(h.presignLessonObjectUrl).toHaveBeenCalledWith(
      expect.objectContaining({ key: "ticket-attachments/t1/k", filename: "shot.png" }),
    );
  });

  it("returns one identical 404 for every denial and never presigns", async () => {
    h.getTicketAttachmentDownload.mockRejectedValue(new h.NotFound());
    const responses = await Promise.all(["missing", "internal", "uploading", "stranger"].map(call));
    const bodies = await Promise.all(responses.map((r) => r.text()));
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(new Set(bodies)).toEqual(new Set([""]));
    expect(h.presignLessonObjectUrl).not.toHaveBeenCalled();
  });

  it("does not swallow unexpected errors", async () => {
    h.getTicketAttachmentDownload.mockRejectedValue(new Error("boom"));
    await expect(call("a1")).rejects.toThrow("boom");
  });
});
