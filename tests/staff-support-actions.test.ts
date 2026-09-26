import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  class AuthorizationError extends Error {}
  class AuthenticationError extends Error {}
  class StaleTicketVersionError extends Error {}
  return {
    AuthorizationError,
    AuthenticationError,
    StaleTicketVersionError,
    svc: {
      claimTicket: vi.fn(),
      assignTicket: vi.fn(),
      acceptTicketEscalation: vi.fn(),
      moveTicketQueue: vi.fn(),
      changeTicketPriority: vi.fn(),
      escalateTicket: vi.fn(),
      resolveTicket: vi.fn(),
      addPublicTicketReply: vi.fn(),
      addInternalTicketNote: vi.fn(),
    },
    listTicketAssignees: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/permissions", () => ({
  AuthorizationError: h.AuthorizationError,
  AuthenticationError: h.AuthenticationError,
}));
vi.mock("@/server/services/ticket-service", () => ({ ...h.svc, StaleTicketVersionError: h.StaleTicketVersionError }));
vi.mock("@/server/services/ticket-staff-queue-service", () => ({ listTicketAssignees: h.listTicketAssignees }));

import {
  acceptEscalationAction,
  addInternalNoteAction,
  assignTicketAction,
  changePriorityAction,
  claimTicketAction,
  escalateTicketAction,
  moveQueueAction,
  resolveTicketAction,
  sendPublicReplyAction,
} from "@/app/staff/support/[reference]/actions";

const base = { reference: "KQT-1", expectedVersion: 3 };

beforeEach(() => {
  for (const fn of Object.values(h.svc)) fn.mockReset().mockResolvedValue({ messageId: "m1" });
  h.listTicketAssignees.mockReset().mockResolvedValue([{ id: "s2", name: "Kim Agent" }]);
});

describe("staff support server actions", () => {
  it("each action calls its own distinct command with expectedVersion", async () => {
    await claimTicketAction(base);
    await acceptEscalationAction(base);
    await assignTicketAction({ ...base, assigneeId: "s2", reason: "cover" });
    await moveQueueAction({ ...base, queue: "FINANCE", reason: "refund" });
    await changePriorityAction({ ...base, priority: "URGENT", reason: "exam" });
    await escalateTicketAction({ ...base, queue: "TECHNICAL", assigneeId: "s2", reason: "engineer" });
    await resolveTicketAction({ ...base, reason: "fixed" });
    await sendPublicReplyAction({ ...base, body: "hello" });
    await addInternalNoteAction({ ...base, body: "note" });

    expect(h.svc.claimTicket).toHaveBeenCalledWith(base);
    expect(h.svc.acceptTicketEscalation).toHaveBeenCalledWith(base);
    expect(h.svc.assignTicket).toHaveBeenCalledWith({ ...base, assigneeId: "s2", reason: "cover" });
    expect(h.svc.moveTicketQueue).toHaveBeenCalledWith({ ...base, queue: "FINANCE", reason: "refund" });
    expect(h.svc.changeTicketPriority).toHaveBeenCalledWith({ ...base, priority: "URGENT", reason: "exam" });
    expect(h.svc.escalateTicket).toHaveBeenCalledWith({ ...base, queue: "TECHNICAL", assigneeId: "s2", reason: "engineer" });
    expect(h.svc.resolveTicket).toHaveBeenCalledWith({ ...base, reason: "fixed" });
    expect(h.svc.addPublicTicketReply).toHaveBeenCalledWith({ ...base, body: "hello" });
    expect(h.svc.addInternalTicketNote).toHaveBeenCalledWith({ ...base, body: "note" });
  });

  it("rejects payloads without a version, with unknown queues, or missing required reasons before any command", async () => {
    // @ts-expect-error missing expectedVersion is the point of the test
    expect((await claimTicketAction({ reference: "KQT-1" })).ok).toBe(false);
    // @ts-expect-error bogus queue is the point of the test
    expect((await moveQueueAction({ ...base, queue: "SALES", reason: "x" })).ok).toBe(false);
    expect((await escalateTicketAction({ ...base, queue: "FINANCE", reason: "  " })).ok).toBe(false);
    expect((await resolveTicketAction({ ...base, reason: "" })).ok).toBe(false);
    expect(Object.values(h.svc).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("maps a stale version to a conflict result with the exact banner copy", async () => {
    h.svc.resolveTicket.mockRejectedValue(new h.StaleTicketVersionError());
    const result = await resolveTicketAction({ ...base, reason: "fixed" });
    expect(result).toEqual({
      ok: false,
      kind: "conflict",
      message: "This ticket changed while you were working. We loaded the latest activity—review it and try again.",
    });
    expect(h.svc.resolveTicket).toHaveBeenCalledTimes(1);
  });

  it("maps a service authorization failure to denied, never a success", async () => {
    h.svc.claimTicket.mockRejectedValue(new h.AuthorizationError("tickets.manage required"));
    const result = await claimTicketAction(base);
    expect(result).toMatchObject({ ok: false, kind: "denied" });
  });

  it("maps an already-assigned claim to a validation result with the reassignment guidance", async () => {
    const { TicketAlreadyAssignedError } = await import("@/server/services/ticket-lifecycle");
    h.svc.claimTicket.mockRejectedValue(new TicketAlreadyAssignedError(false));
    const result = await claimTicketAction(base);
    expect(result).toMatchObject({ ok: false, kind: "validation" });
    expect((result as { message: string }).message).toContain("Ask a manager to reassign it");
  });

  it("does not assign to a user outside the eligible support owners", async () => {
    const result = await assignTicketAction({ ...base, assigneeId: "someone-else", reason: "x" });
    expect(result).toMatchObject({ ok: false, kind: "validation" });
    expect(h.svc.assignTicket).not.toHaveBeenCalled();
    const escalated = await escalateTicketAction({ ...base, queue: "FINANCE", assigneeId: "someone-else", reason: "x" });
    expect(escalated).toMatchObject({ ok: false, kind: "validation" });
    expect(h.svc.escalateTicket).not.toHaveBeenCalled();
  });

  it("surfaces reason violations from the service as validation, not a crash", async () => {
    const { TicketReasonRequiredError } = await import("@/server/services/ticket-lifecycle");
    h.svc.assignTicket.mockRejectedValue(new TicketReasonRequiredError("replacing the ticket owner"));
    const result = await assignTicketAction({ ...base, assigneeId: "s2" });
    expect(result).toMatchObject({ ok: false, kind: "validation" });
  });

  it("returns the created message id so attachments can be uploaded", async () => {
    await expect(sendPublicReplyAction({ ...base, body: "hello" })).resolves.toEqual({ ok: true, messageId: "m1" });
  });
});
