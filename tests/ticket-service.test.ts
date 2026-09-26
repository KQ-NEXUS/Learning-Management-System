import { describe, expect, it } from "vitest";
import { createTicketService, StaleTicketVersionError, TicketNotFoundError } from "@/server/services/ticket-service";
import { createTicketContextService } from "@/server/services/ticket-context-service";
import { createTestWithPermission, grant } from "./support/harness";
import { makeTicketHarness } from "./support/ticket-harness";

describe("ticket service", () => {
  it("creates a learner ticket atomically with an initial public message, event, audit and redacted domain event", async () => {
    const harness = makeTicketHarness({ actorId: "learner-1" });
    const service = createTicketService(harness.deps);

    const ticket = await service.createOwnTicket({
      category: "TECHNICAL_PROBLEM",
      subject: "  Video playback failed  ",
      body: "  The lesson video stops at 04:12.  ",
      context: { courseId: "course-1" },
    });

    expect(ticket).toMatchObject({
      reference: "KQT-20260921-ABCDEF12",
      subject: "Video playback failed",
      category: "TECHNICAL_PROBLEM",
      status: "NEW",
      priority: "NORMAL",
      queue: "GENERAL_SUPPORT",
      context: expect.objectContaining({ kind: "COURSE", href: null, locked: true }),
    });
    expect(JSON.stringify(ticket)).not.toContain("course-1");
    expect("assigneeId" in ticket).toBe(false);
    expect(harness.tickets).toHaveLength(1);
    expect(harness.messages).toEqual([
      expect.objectContaining({
        ticketId: harness.tickets[0].id,
        authorId: "learner-1",
        kind: "INITIAL",
        visibility: "PUBLIC",
        body: "The lesson video stops at 04:12.",
      }),
    ]);
    expect(harness.events).toEqual([
      expect.objectContaining({ ticketId: harness.tickets[0].id, type: "CREATED", actorId: "learner-1" }),
    ]);
    expect(harness.audits).toEqual([
      expect.objectContaining({
        action: "ticket.created",
        actorId: "learner-1",
        targetType: "Ticket",
        outcome: "SUCCESS",
      }),
    ]);
    expect(harness.domainEvents).toEqual([
      {
        type: "ticket.created",
        payload: {
          ticketId: harness.tickets[0].id,
          reference: "KQT-20260921-ABCDEF12",
          requesterId: "learner-1",
        },
        occurredAt: harness.now,
      },
    ]);
  });

  it("uses ownership parity for learner references", async () => {
    const harness = makeTicketHarness({ actorId: "learner-1" });
    const service = createTicketService(harness.deps);
    await service.createOwnTicket({ category: "OTHER", subject: "Mine", body: "Body" });
    harness.actorId = "learner-2";

    await expect(service.getOwnTicketByReference("KQT-20260921-ABCDEF12")).rejects.toBeInstanceOf(TicketNotFoundError);
    await expect(service.getOwnTicketByReference("KQT-20260921-MISSING1")).rejects.toBeInstanceOf(TicketNotFoundError);
  });

  it("staff reads require tickets.view and merge messages/events by createdAt then id", async () => {
    const harness = makeTicketHarness({ actorId: "staff-1" });
    const { withPermission } = createTestWithPermission([grant("tickets.view")], { userId: "staff-1" });
    const service = createTicketService({ ...harness.deps, withPermission });
    const created = await service.createOwnTicket({ category: "OTHER", subject: "Need help", body: "Initial" });
    harness.messages.push({
      id: "msg-z",
      ticketId: created.id,
      authorId: "staff-1",
      kind: "INTERNAL_NOTE",
      visibility: "INTERNAL",
      body: "Private note",
      createdAt: new Date("2026-09-21T12:01:00.000Z"),
      attachments: [{
        id: "att-staff",
        ticketId: created.id,
        messageId: "msg-z",
        uploadedById: "staff-1",
        filename: "diagnostic.pdf",
        storageKey: "private/raw/storage-key",
        mimeType: "application/pdf",
        sizeBytes: 123,
        uploadStatus: "READY",
        uploadedAt: new Date("2026-09-21T12:01:00.000Z"),
        createdAt: new Date("2026-09-21T12:01:00.000Z"),
      }],
    });
    harness.events.push({
      id: "evt-a",
      ticketId: created.id,
      actorId: "staff-1",
      actorType: "USER",
      type: "ASSIGNED",
      reason: "Triage",
      statusBefore: "NEW",
      statusAfter: "ASSIGNED",
      priorityBefore: null,
      priorityAfter: null,
      queueBefore: null,
      queueAfter: null,
      assigneeBeforeId: null,
      assigneeAfterId: "staff-1",
      createdAt: new Date("2026-09-21T12:01:00.000Z"),
    });

    const detail = await service.getStaffTicketByReference(created.reference);

    expect(detail.timeline.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      "EVENT:evt-1",
      "MESSAGE:msg-1",
      "EVENT:evt-a",
      "MESSAGE:msg-z",
    ]);
    expect(JSON.stringify(detail)).not.toContain("private/raw/storage-key");
  });

  it("staff detail resolves context through a fresh permission check; learner reads stay locked", async () => {
    const harness = makeTicketHarness({ actorId: "learner-1" });
    const { withPermission } = createTestWithPermission([grant("tickets.view")], { userId: "staff-1" });
    const authorizeCalls: Array<{ kind: string; id: string }> = [];
    const service = createTicketService({
      ...harness.deps,
      withPermission,
      contextService: createTicketContextService({
        authorize: async (input) => {
          authorizeCalls.push(input);
          return { href: `/staff/courses/${input.id}` };
        },
      }),
    });
    const created = await service.createOwnTicket({
      category: "COURSE_CONTENT",
      subject: "Lesson question",
      body: "Body",
      context: { courseId: "course-1" },
    });

    const own = await service.getOwnTicketByReference(created.reference);
    expect(own.context).toMatchObject({ kind: "COURSE", href: null, locked: true });

    const detail = await service.getStaffTicketByReference(created.reference);
    expect(detail.context).toMatchObject({ kind: "COURSE", href: "/staff/courses/course-1", locked: false });
    expect(authorizeCalls).toEqual([{ kind: "COURSE", id: "course-1" }]);
  });

  it("rejects stale command versions with one typed conflict", async () => {
    const harness = makeTicketHarness({ actorId: "staff-1" });
    const { withPermission } = createTestWithPermission([grant("tickets.manage")], { userId: "staff-1" });
    const service = createTicketService({ ...harness.deps, withPermission });
    const created = await service.createOwnTicket({ category: "OTHER", subject: "Race", body: "Initial" });

    await service.claimTicket({ reference: created.reference, expectedVersion: 1 });
    await expect(service.resolveTicket({ reference: created.reference, expectedVersion: 1 })).rejects.toBeInstanceOf(
      StaleTicketVersionError,
    );
  });

  it("writes versioned assignment, public reply, internal note and resolution events without leaking private text to domain events", async () => {
    const harness = makeTicketHarness({ actorId: "staff-1" });
    const { withPermission } = createTestWithPermission([grant("tickets.manage")], { userId: "staff-1" });
    const service = createTicketService({ ...harness.deps, withPermission });
    const created = await service.createOwnTicket({ category: "OTHER", subject: "Thread", body: "Initial" });

    await service.assignTicket({ reference: created.reference, expectedVersion: 1, assigneeId: "staff-2" });
    await service.addPublicReply({ reference: created.reference, expectedVersion: 2, body: "Public update" });
    await service.addInternalNote({ reference: created.reference, expectedVersion: 3, body: "Private diagnosis" });
    await service.resolveTicket({ reference: created.reference, expectedVersion: 4, reason: "Fixed" });

    expect(harness.tickets[0]).toMatchObject({ version: 5, status: "RESOLVED", assigneeId: "staff-2" });
    expect(harness.events.map((event) => event.type)).toEqual([
      "CREATED",
      "ASSIGNED",
      "RESOLVED",
    ]);
    expect(harness.domainEvents.map((event) => event.type)).toEqual([
      "ticket.created",
      "ticket.assigned",
      "ticket.public_reply_added",
      "ticket.resolved",
    ]);
    expect(harness.audits.map((audit) => (audit as { action: string }).action)).toEqual([
      "ticket.created",
      "ticket.assigned",
      "ticket.public_reply_added",
      "ticket.internal_note_added",
      "ticket.resolved",
    ]);
    const serializedEvents = JSON.stringify(harness.domainEvents);
    expect(serializedEvents).not.toContain("Public update");
    expect(serializedEvents).not.toContain("Private diagnosis");
    expect(serializedEvents).not.toContain("Fixed");
  });

  it("keeps firstRespondedAt from the first public reply and requires an urgent priority reason", async () => {
    const harness = makeTicketHarness({ actorId: "staff-1" });
    const { withPermission } = createTestWithPermission([grant("tickets.manage")], { userId: "staff-1" });
    const service = createTicketService({ ...harness.deps, withPermission });
    const created = await service.createOwnTicket({ category: "OTHER", subject: "Priority", body: "Initial" });

    await expect(
      service.changePriority({ reference: created.reference, expectedVersion: 1, priority: "URGENT" }),
    ).rejects.toThrow("reason is required");
    await service.addPublicReply({ reference: created.reference, expectedVersion: 1, body: "First reply" });
    const firstResponse = harness.tickets[0].firstRespondedAt;
    harness.now = new Date("2026-09-21T13:00:00.000Z");
    await service.addPublicReply({ reference: created.reference, expectedVersion: 2, body: "Second reply" });

    expect(harness.tickets[0].firstRespondedAt).toBe(firstResponse);
  });

  it("supports escalation, accept escalation, learner reopen and learner close as versioned attributed commands", async () => {
    const harness = makeTicketHarness({ actorId: "learner-1" });
    const { withPermission } = createTestWithPermission([grant("tickets.manage")], { userId: "staff-1" });
    const service = createTicketService({ ...harness.deps, withPermission });
    const created = await service.createOwnTicket({ category: "OTHER", subject: "Lifecycle", body: "Initial" });

    harness.actorId = "staff-1";
    await expect(service.escalateTicket({ reference: created.reference, expectedVersion: 1 })).rejects.toThrow(
      "reason is required",
    );
    await service.escalateTicket({ reference: created.reference, expectedVersion: 1, queue: "TECHNICAL", reason: "Needs specialist" });
    await service.acceptEscalation({ reference: created.reference, expectedVersion: 2 });
    await service.resolveTicket({ reference: created.reference, expectedVersion: 3, reason: "Answered" });
    harness.actorId = "learner-1";
    await service.reopenOwnTicket({ reference: created.reference, expectedVersion: 4, reason: "Still broken" });
    await service.resolveTicket({ reference: created.reference, expectedVersion: 5, reason: "Fixed again" });
    await service.closeOwnTicket({ reference: created.reference, expectedVersion: 6 });

    expect(harness.tickets[0]).toMatchObject({ status: "CLOSED", version: 7, queue: "TECHNICAL" });
    expect(harness.events.map((event) => event.type)).toEqual([
      "CREATED",
      "ESCALATED",
      "ESCALATION_ACCEPTED",
      "RESOLVED",
      "REOPENED",
      "RESOLVED",
      "LEARNER_CLOSED",
    ]);
    expect(harness.domainEvents.map((event) => event.type)).toEqual([
      "ticket.created",
      "ticket.escalated",
      "ticket.resolved",
      "ticket.reopened",
      "ticket.resolved",
      "ticket.closed",
    ]);
    expect(harness.audits.map((audit) => (audit as { action: string }).action)).toEqual([
      "ticket.created",
      "ticket.escalated",
      "ticket.escalation_accepted",
      "ticket.resolved",
      "ticket.reopened",
      "ticket.resolved",
      "ticket.closed",
    ]);
  });

  describe("learner own reply and detail lifecycle flags (12-05)", () => {
    it("adds a public learner reply guarded by version and returns the message id", async () => {
      const harness = makeTicketHarness({ actorId: "learner-1" });
      const service = createTicketService(harness.deps);
      const created = await service.createOwnTicket({ category: "OTHER", subject: "Mine", body: "Body" });
      expect(created.initialMessageId).toBe("msg-1");

      const sent = await service.addOwnReply({ reference: created.reference, expectedVersion: 1, body: "  More detail  " });
      expect(sent.messageId).toBe("msg-2");
      expect(harness.messages[1]).toMatchObject({ kind: "REPLY", visibility: "PUBLIC", authorId: "learner-1", body: "More detail" });
      await expect(
        service.addOwnReply({ reference: created.reference, expectedVersion: 1, body: "stale" }),
      ).rejects.toBeInstanceOf(StaleTicketVersionError);
    });

    it("rejects replies on another learner's ticket and on resolved or closed tickets", async () => {
      const harness = makeTicketHarness({ actorId: "learner-1" });
      const service = createTicketService(harness.deps);
      const created = await service.createOwnTicket({ category: "OTHER", subject: "Mine", body: "Body" });
      harness.tickets[0].status = "RESOLVED";
      harness.tickets[0].resolvedAt = harness.now;
      await expect(
        service.addOwnReply({ reference: created.reference, expectedVersion: 1, body: "hi" }),
      ).rejects.toThrow("not open for replies");
      harness.actorId = "learner-2";
      await expect(
        service.addOwnReply({ reference: created.reference, expectedVersion: 1, body: "hi" }),
      ).rejects.toBeInstanceOf(TicketNotFoundError);
    });

    it("computes canReply/canClose/canReopen and the auto-close date on the server, inclusive at the exact boundary", async () => {
      const harness = makeTicketHarness({ actorId: "learner-1" });
      const service = createTicketService(harness.deps);
      const created = await service.createOwnTicket({ category: "OTHER", subject: "Mine", body: "Body" });
      const open = await service.getOwnTicketByReference(created.reference);
      expect(open).toMatchObject({ canReply: true, canClose: false, canReopen: false, autoCloseAt: null });
      expect(open.messages[0]).toMatchObject({ authorRole: "LEARNER" });

      const resolvedAt = new Date("2026-09-21T12:00:00.000Z");
      harness.tickets[0].status = "RESOLVED";
      harness.tickets[0].resolvedAt = resolvedAt;
      harness.now = new Date(resolvedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      const atBoundary = await service.getOwnTicketByReference(created.reference);
      expect(atBoundary).toMatchObject({ canReply: false, canClose: true, canReopen: true });
      expect(atBoundary.autoCloseAt?.toISOString()).toBe("2026-09-28T12:00:00.000Z");

      harness.now = new Date(resolvedAt.getTime() + 7 * 24 * 60 * 60 * 1000 + 1);
      const after = await service.getOwnTicketByReference(created.reference);
      expect(after).toMatchObject({ canReopen: false, canClose: true });
    });
  });
});
