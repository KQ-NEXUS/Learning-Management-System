import { describe, expect, it } from "vitest";
import {
  TICKET_TRANSITIONS,
  assertAssignmentReason,
  assertEscalationReason,
  assertPriorityReason,
  assertReopenReason,
  assertTicketTransition,
  canLearnerClose,
  canLearnerReopen,
  statusAfterPublicReply,
  ticketReopenDeadline,
} from "@/server/services/ticket-lifecycle";
import {
  TICKET_MAX_ATTACHMENTS_PER_MESSAGE,
  TICKET_MAX_ATTACHMENT_BYTES,
  TICKET_UPLOAD_MIME_TYPES,
  validateTicketUpload,
} from "@/lib/upload-limits";

describe("ticket lifecycle", () => {
  it.each(["NEW", "OPEN", "ASSIGNED", "ESCALATED"] as const)(
    "allows staff to resolve %s tickets",
    (status) => {
      expect(() => assertTicketTransition(status, "RESOLVED")).not.toThrow();
    },
  );

  it("makes CLOSED terminal", () => {
    expect(TICKET_TRANSITIONS.CLOSED).toEqual([]);
    expect(() => assertTicketTransition("CLOSED", "OPEN")).toThrow(
      "A ticket cannot move from CLOSED to OPEN.",
    );
  });

  it("lets the learner close only a resolved ticket", () => {
    expect(canLearnerClose("RESOLVED")).toBe(true);
    expect(canLearnerClose("OPEN")).toBe(false);
    expect(canLearnerClose("CLOSED")).toBe(false);
  });

  it("uses an inclusive seven-day reopen boundary", () => {
    const resolvedAt = new Date("2026-09-01T12:00:00.000Z");
    const deadline = new Date("2026-09-08T12:00:00.000Z");

    expect(ticketReopenDeadline(resolvedAt)).toEqual(deadline);
    expect(canLearnerReopen("RESOLVED", resolvedAt, deadline)).toBe(true);
    expect(
      canLearnerReopen(
        "RESOLVED",
        resolvedAt,
        new Date(deadline.getTime() + 1),
      ),
    ).toBe(false);
    expect(canLearnerReopen("CLOSED", resolvedAt, deadline)).toBe(false);
  });

  it.each([
    ["reopen", assertReopenReason],
    ["escalation", assertEscalationReason],
    ["Urgent priority", (reason: string | null | undefined) => assertPriorityReason("URGENT", reason)],
    ["owner replacement", (reason: string | null | undefined) => assertAssignmentReason("old-owner", "new-owner", reason)],
  ] as const)("requires a non-empty reason for %s", (_label, assertReason) => {
    expect(() => assertReason("  ")).toThrow("reason is required");
    expect(() => assertReason("Operational context")).not.toThrow();
  });

  it("does not require a reason for non-Urgent priority or a first assignment", () => {
    expect(() => assertPriorityReason("HIGH", undefined)).not.toThrow();
    expect(() => assertAssignmentReason(null, "new-owner", undefined)).not.toThrow();
  });

  it("opens NEW after a public reply without erasing assigned or escalated states", () => {
    expect(statusAfterPublicReply("NEW")).toBe("OPEN");
    expect(statusAfterPublicReply("ASSIGNED")).toBe("ASSIGNED");
    expect(statusAfterPublicReply("ESCALATED")).toBe("ESCALATED");
  });
});

describe("ticket upload limits", () => {
  it("caps each message at three files of ten MiB", () => {
    expect(TICKET_MAX_ATTACHMENTS_PER_MESSAGE).toBe(3);
    expect(TICKET_MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
  });

  it("accepts exactly PNG, JPEG, WebP and PDF MIME types", () => {
    expect(TICKET_UPLOAD_MIME_TYPES).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
    ]);
  });

  it.each(["image/svg+xml", "text/html", "application/zip", "application/x-msdownload"])(
    "rejects active or container content: %s",
    (mimeType) => {
      expect(validateTicketUpload({ mimeType, sizeBytes: 512 })).toEqual(
        expect.objectContaining({ ok: false }),
      );
    },
  );

  it("rejects an oversized otherwise-allowed file", () => {
    expect(
      validateTicketUpload({
        mimeType: "application/pdf",
        sizeBytes: TICKET_MAX_ATTACHMENT_BYTES + 1,
      }),
    ).toEqual(expect.objectContaining({ ok: false }));
  });
});
