import { describe, expect, it } from "vitest";
import { createTicketService } from "@/server/services/ticket-service";
import { createTestWithPermission, grant } from "./support/harness";
import { makeTicketHarness } from "./support/ticket-harness";

async function setup() {
  const harness = makeTicketHarness({ actorId: "learner-1" });
  const { withPermission } = createTestWithPermission([grant("tickets.manage")], { userId: "staff-1" });
  const service = createTicketService({ ...harness.deps, withPermission });
  const created = await service.createOwnTicket({ category: "OTHER", subject: "Staff cmds", body: "Initial" });
  harness.actorId = "staff-1";
  return { harness, service, reference: created.reference };
}

describe("staff ticket commands added in 12-07", () => {
  it("moves queue with a required reason, an attributed QUEUE_CHANGED event and an audit row", async () => {
    const { harness, service, reference } = await setup();
    await expect(service.moveQueue({ reference, expectedVersion: 1, queue: "FINANCE", reason: "  " })).rejects.toThrow();
    await service.moveQueue({ reference, expectedVersion: 1, queue: "FINANCE", reason: "Refund question" });
    expect(harness.tickets[0]).toMatchObject({ queue: "FINANCE", version: 2 });
    expect(harness.events.at(-1)).toMatchObject({
      type: "QUEUE_CHANGED", actorId: "staff-1", reason: "Refund question", queueBefore: "GENERAL_SUPPORT", queueAfter: "FINANCE",
    });
    expect(harness.audits.map((a) => (a as { action: string }).action)).toContain("ticket.queue_moved");
  });

  it("rejects a queue move at a stale version", async () => {
    const { service, reference } = await setup();
    await service.claimTicket({ reference, expectedVersion: 1 });
    await expect(service.moveQueue({ reference, expectedVersion: 1, queue: "ACCOUNTS", reason: "x" })).rejects.toThrow("changed while you were working");
  });

  it("escalates to a queue with an optional owner and stays ESCALATED until accepted", async () => {
    const { harness, service, reference } = await setup();
    await expect(service.escalateTicket({ reference, expectedVersion: 1, queue: "TECHNICAL", reason: "" })).rejects.toThrow("reason is required");
    await service.escalateTicket({ reference, expectedVersion: 1, queue: "TECHNICAL", assigneeId: "staff-2", reason: "Needs engineer" });
    expect(harness.tickets[0]).toMatchObject({ status: "ESCALATED", queue: "TECHNICAL", assigneeId: "staff-2" });
    expect(harness.events.at(-1)).toMatchObject({ type: "ESCALATED", assigneeAfterId: "staff-2", queueAfter: "TECHNICAL" });
    await service.acceptEscalation({ reference, expectedVersion: 2 });
    expect(harness.tickets[0]).toMatchObject({ status: "ASSIGNED", assigneeId: "staff-1" });
  });

  it("refuses to claim a ticket owned by someone else and points to reassignment", async () => {
    const { harness, service, reference } = await setup();
    await service.assignTicket({ reference, expectedVersion: 1, assigneeId: "staff-2" });
    const eventCount = harness.events.length;
    await expect(service.claimTicket({ reference, expectedVersion: 2 })).rejects.toThrow("Ask a manager to reassign it");
    expect(harness.tickets[0].assigneeId).toBe("staff-2");
    expect(harness.events).toHaveLength(eventCount);
  });

  it("refuses to re-claim an own ticket without writing a misleading REASSIGNED event", async () => {
    const { harness, service, reference } = await setup();
    await service.claimTicket({ reference, expectedVersion: 1 });
    const eventCount = harness.events.length;
    await expect(service.claimTicket({ reference, expectedVersion: 2 })).rejects.toThrow("You already own this ticket");
    expect(harness.events).toHaveLength(eventCount);
    expect(harness.events.some((e) => (e as { type: string }).type === "REASSIGNED")).toBe(false);
    expect(harness.events.at(-1)).toMatchObject({ type: "CLAIMED", actorId: "staff-1" });
  });

  it("returns the created message id from public replies and internal notes", async () => {
    const { harness, service, reference } = await setup();
    const reply = await service.addPublicReply({ reference, expectedVersion: 1, body: "Hello" });
    const note = await service.addInternalNote({ reference, expectedVersion: 2, body: "Private" });
    const ids = harness.messages.map((m) => m.id);
    expect(ids).toContain(reply.messageId);
    expect(ids).toContain(note.messageId);
    expect(reply.messageId).not.toBe(note.messageId);
  });
});
