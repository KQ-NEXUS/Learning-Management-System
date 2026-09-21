import { describe, expect, it } from "vitest";
import { createTicketService } from "@/server/services/ticket-service";
import { makeTicketHarness } from "./support/ticket-harness";

describe("ticket learner privacy", () => {
  it("returns only public messages and public-message attachments to the learner", async () => {
    const harness = makeTicketHarness({ actorId: "learner-1" });
    const service = createTicketService(harness.deps);
    const created = await service.createOwnTicket({ category: "OTHER", subject: "Privacy", body: "Public body" });
    harness.messages[0].attachments.push({
      id: "att-public",
      ticketId: created.id,
      messageId: harness.messages[0].id,
      uploadedById: "learner-1",
      filename: "screenshot.png",
      storageKey: "private/tickets/public",
      mimeType: "image/png",
      sizeBytes: 100,
      uploadStatus: "READY",
      uploadedAt: new Date("2026-09-21T12:00:00.000Z"),
      createdAt: new Date("2026-09-21T12:00:00.000Z"),
    });
    harness.messages.push({
      id: "msg-private",
      ticketId: created.id,
      authorId: "staff-1",
      kind: "INTERNAL_NOTE",
      visibility: "INTERNAL",
      body: "Private escalation note",
      createdAt: new Date("2026-09-21T12:01:00.000Z"),
      attachments: [{
        id: "att-private",
        ticketId: created.id,
        messageId: "msg-private",
        uploadedById: "staff-1",
        filename: "internal-ledger.pdf",
        storageKey: "private/tickets/internal",
        mimeType: "application/pdf",
        sizeBytes: 200,
        uploadStatus: "READY",
        uploadedAt: new Date("2026-09-21T12:01:00.000Z"),
        createdAt: new Date("2026-09-21T12:01:00.000Z"),
      }],
    });

    const detail = await service.getOwnTicketByReference(created.reference);
    const serialized = JSON.stringify(detail);

    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0].attachments).toEqual([
      expect.objectContaining({ id: "att-public", filename: "screenshot.png" }),
    ]);
    expect(serialized).not.toContain("Private escalation note");
    expect(serialized).not.toContain("msg-private");
    expect(serialized).not.toContain("staff-1");
    expect(serialized).not.toContain("assigneeId");
    expect(serialized).not.toContain("authorId");
    expect(serialized).not.toContain("internal-ledger.pdf");
    expect(serialized).not.toContain("private/tickets/internal");
    expect(serialized).not.toContain("events");
  });
});
